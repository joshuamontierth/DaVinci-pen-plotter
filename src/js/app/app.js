/*
 * DaVinci - application controller: profiles, plan building, object
 * operations, tool strip, status and plot bars, keyboard shortcuts, file handling.
 */
(function (PP) {
  'use strict';

  const U = PP.U, S = PP.Store, G = PP.Geo, OBJ = PP.Objects, h = U.h;

  const events = new U.Emitter();

  const App = {
    events,
    view: null,
    drawSettings: Object.assign({ smoothing: 1, sides: 6, starPoints: 5, starInner: 0.45, eraserSize: 4, cornerRadius: 0 }, PP.Storage.getLocal('draw', {})),
    prefs: Object.assign({ simplify: 0.02, joinTol: 0.05, reorder: true, reverse: true, minLength: 0 }, PP.Storage.getLocal('prefs', {})),
    clipboard: null,
  };

  // ---------------------------------------------------------------------------
  // Printer profiles
  // ---------------------------------------------------------------------------
  let profStore = PP.Storage.getLocal('profiles', null) || { overrides: {}, custom: [], active: 'bambu-x1c' };
  let profCache = null;

  function allProfiles() {
    const list = PP.GCode.BUILTIN_PROFILES.map(b => Object.assign({}, b, profStore.overrides[b.id] || {}, { id: b.id, builtin: true }));
    return list.concat(profStore.custom.map(c => Object.assign({}, c, { builtin: false })));
  }
  function saveProfiles() {
    const old = profCache;
    PP.Storage.setLocal('profiles', profStore); profCache = null; events.emit('profile');
    if (!App.view) return;
    // refit when the bed size changed (edited, or the active profile was deleted), otherwise just redraw
    const p = App.profile();
    if (old && (old.bedWidth !== p.bedWidth || old.bedDepth !== p.bedDepth)) App.view.fit(); else App.view.invalidate();
  }

  App.profiles = allProfiles;
  App.profile = function () {
    if (profCache) return profCache;
    const list = allProfiles();
    const p = list.find(x => x.id === profStore.active) || list[0];
    profCache = PP.GCode.normalizeProfile(p);
    profCache.id = p.id; profCache.name = p.name; profCache.mount = p.mount; profCache.builtin = p.builtin;
    return profCache;
  };
  App.setProfile = function (id) {
    if (!allProfiles().some(p => p.id === id)) return;
    profStore.active = id;
    saveProfiles();
    if (App.view) App.view.fit();
  };
  App.updateProfile = function (patch, id = profStore.active) {
    const b = PP.GCode.BUILTIN_PROFILES.find(x => x.id === id);
    if (b) {
      const ov = Object.assign({}, profStore.overrides[id] || {}, patch);
      delete ov.id; delete ov.builtin;
      profStore.overrides[id] = ov;
    } else {
      const c = profStore.custom.find(x => x.id === id);
      if (c) Object.assign(c, patch);
    }
    saveProfiles();
  };
  App.resetProfile = function (id = profStore.active) { delete profStore.overrides[id]; saveProfiles(); };
  App.duplicateProfile = function (id = profStore.active, name) {
    const src = allProfiles().find(p => p.id === id) || App.profile();
    const copy = Object.assign({}, src, { id: U.uid('prof'), name: name || (src.name + ' (copy)'), builtin: false });
    profStore.custom.push(copy);
    profStore.active = copy.id;
    saveProfiles();
    return copy.id;
  };
  App.deleteProfile = function (id) {
    const i = profStore.custom.findIndex(c => c.id === id);
    if (i < 0) return;
    profStore.custom.splice(i, 1);
    if (profStore.active === id) profStore.active = 'bambu-x1c';
    saveProfiles();
  };
  App.setPrefs = function (patch) {
    Object.assign(App.prefs, patch);
    PP.Storage.setLocal('prefs', App.prefs);
    events.emit('prefs');
    S.events.emit('change', 'prefs');
  };
  App.saveDrawSettings = U.debounce(() => PP.Storage.setLocal('draw', App.drawSettings), 400);

  // ---------------------------------------------------------------------------
  // Plan (what will be plotted)
  // ---------------------------------------------------------------------------
  /** Build ordered, clipped pen paths per visible layer. */
  App.buildPlan = function (opts = {}) {
    const p = opts.profile ? PP.GCode.normalizeProfile(opts.profile) : App.profile();
    const prefs = Object.assign({}, App.prefs, opts.prefs || {});
    const R = PP.GCode.reachableRect(p);
    let start = { x: p.parkX + p.penOffsetX, y: p.parkY + p.penOffsetY };
    const jobs = [];
    let clipped = false, removed = 0;
    for (const L of S.project.layers) {
      if (!L.visible) continue;
      if (opts.layerIds && !opts.layerIds.includes(L.id)) continue;
      const polys = [];
      for (const o of S.project.objects) {
        if (o.layerId !== L.id) continue;
        for (const q of OBJ.world(o).polys) polys.push(q);
      }
      if (!polys.length) continue;
      const prep = PP.Optimizer.prepare(polys, { tolerance: prefs.simplify, rect: R, minLength: prefs.minLength });
      clipped = clipped || prep.clipped;
      removed += prep.removed;
      const ordered = PP.Optimizer.order(prep.polys, start, { reorder: prefs.reorder, reverse: prefs.reverse, joinTol: prefs.joinTol });
      if (!ordered.length) continue;
      const last = ordered[ordered.length - 1];
      start = { x: last[last.length - 2], y: last[last.length - 1] };
      jobs.push({
        layerId: L.id, name: L.name, color: L.color, polys: ordered,
        zDraw: U.isNum(L.zDraw) ? L.zDraw : undefined,
        drawSpeed: U.isNum(L.speed) && L.speed > 0 ? L.speed : undefined,
      });
    }
    let time = 0, drawLen = 0, travelLen = 0, lifts = 0;
    let s0 = { x: p.parkX + p.penOffsetX, y: p.parkY + p.penOffsetY };
    for (const j of jobs) {
      const e = PP.Optimizer.estimate(j.polys, s0, Object.assign({}, p, { drawSpeed: j.drawSpeed || p.drawSpeed }));
      j.est = e;
      time += e.time; drawLen += e.drawLen; travelLen += e.travelLen; lifts += e.lifts;
      const last = j.polys[j.polys.length - 1];
      s0 = { x: last[last.length - 2], y: last[last.length - 1] };
    }
    return { jobs, clipped, removed, profile: p, stats: { time, drawLen, travelLen, lifts }, start: { x: p.parkX + p.penOffsetX, y: p.parkY + p.penOffsetY } };
  };

  // ---------------------------------------------------------------------------
  // Placement helpers
  // ---------------------------------------------------------------------------
  /** Area where new content should go: paper ∩ drawable area (or drawable area). */
  App.workArea = function () {
    const R = PP.GCode.reachableRect(App.profile());
    const pa = S.project.paper;
    if (pa.visible) {
      const r = { minX: Math.max(R.minX, pa.x), minY: Math.max(R.minY, pa.y), maxX: Math.min(R.maxX, pa.x + pa.w), maxY: Math.min(R.maxY, pa.y + pa.h) };
      if (r.maxX - r.minX > 20 && r.maxY - r.minY > 20) return r;
    }
    return R;
  };
  App.placementCenter = function () {
    const r = App.workArea();
    return { x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 };
  };

  /** Add objects centered in the work area, scaling down (uniformly, as a group) if too big. */
  /** Why a plan has nothing to draw, for toasts and the summary. */
  App.emptyPlanMessage = function (plan) {
    const objs = S.project.objects;
    if (!objs.length) return 'Nothing to plot yet - add text, drawings, images or patterns.';
    if (plan.clipped) return 'Everything is outside the drawable area (the striped zone) - move it onto the paper.';
    const shown = objs.filter(o => { const L = S.layer(o.layerId); return L && L.visible; });
    if (!shown.length) return 'All objects are on hidden layers - show a layer to plot it.';
    return 'The visible objects have no lines to draw.';
  };

  /** Objects go to the active layer: refuse, as the canvas tools do, when it is hidden or locked. */
  App.requireEditableLayer = function () {
    const L = S.activeLayer();
    if (L && L.visible && !L.locked) return true;
    PP.UI.toast('The active layer "' + (L ? L.name : '?') + '" is ' + (L && L.locked ? 'locked' : 'hidden') + '. Pick another layer or ' + (L && L.locked ? 'unlock' : 'show') + ' it.', 'warn');
    return false;
  };

  App.addPlaced = function (objs, opts = {}) {
    if (!objs.length) return [];
    if (!opts.keepLayers && !App.requireEditableLayer()) return [];
    const area = App.workArea();
    const margin = opts.margin === undefined ? 8 : opts.margin;
    let bb = null;
    for (const o of objs) bb = G.bboxUnion(bb, OBJ.world(o).bbox);
    if (!bb) return S.add(objs, opts);
    const aw = Math.max(10, area.maxX - area.minX - 2 * margin), ah = Math.max(10, area.maxY - area.minY - 2 * margin);
    const bw = bb.maxX - bb.minX, bh = bb.maxY - bb.minY;
    let k = 1;
    if (opts.fit || bw > aw || bh > ah) k = Math.min(aw / (bw || 1), ah / (bh || 1));
    if (opts.fit === false) k = 1;
    const c0 = { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 };
    const c1 = App.placementCenter();
    const placed = objs.map(o => Object.assign({}, o, {
      x: c1.x + (o.x - c0.x) * k, y: c1.y + (o.y - c0.y) * k, scaleX: o.scaleX * k, scaleY: o.scaleY * k,
    }));
    return S.add(placed, opts);
  };

  // ---------------------------------------------------------------------------
  // Object operations
  // ---------------------------------------------------------------------------
  const editableSel = () => S.selected().filter(S.isEditable);

  function groupBBox(objs) {
    let bb = null;
    for (const o of objs) bb = G.bboxUnion(bb, OBJ.world(o).bbox);
    return bb;
  }

  App.ops = {
    selectAll() { S.select(S.project.objects.filter(S.isEditable).map(o => o.id)); },
    remove() { const ids = editableSel().map(o => o.id); if (ids.length) S.remove(ids); },
    duplicate() {
      const sel = editableSel();
      if (!sel.length) return;
      const copies = sel.map(o => Object.assign({}, o, { id: U.uid('o'), x: o.x + 5, y: o.y - 5 }));
      S.add(copies, { layerId: null });
    },
    copy() {
      const sel = S.selected();
      if (!sel.length) return;
      App.clipboard = sel.map(o => Object.assign({}, o));
      events.emit('clipboard');
      PP.UI.toast(sel.length + ' object' + (sel.length > 1 ? 's' : '') + ' copied', 'info', 1500);
    },
    cut() { App.ops.copy(); App.ops.remove(); },
    paste() {
      if (!App.requireEditableLayer()) return;
      if (!App.clipboard || !App.clipboard.length) return;
      const copies = App.clipboard.map(o => Object.assign({}, o, { id: U.uid('o'), x: o.x + 5, y: o.y - 5, layerId: S.activeLayer().id }));
      App.clipboard = copies.map(o => Object.assign({}, o));
      S.add(copies);
    },
    nudge(dx, dy) {
      const sel = editableSel();
      if (!sel.length) return;
      const m = new Map(sel.map(o => [o.id, { x: o.x + dx, y: o.y + dy }]));
      S.updateMany(m);
    },
    mirror(axis) {
      const sel = editableSel();
      if (!sel.length) return;
      const bb = groupBBox(sel);
      const c = G.bboxCenter(bb);
      const m = new Map(sel.map(o => {
        // mirroring in world space: reflect position and flip the object's local axis
        if (axis === 'x') return [o.id, { x: 2 * c.x - o.x, rotation: -o.rotation, scaleX: -o.scaleX }];
        return [o.id, { y: 2 * c.y - o.y, rotation: -o.rotation, scaleY: -o.scaleY }];
      }));
      S.updateMany(m);
    },
    rotateBy(deg) {
      const sel = editableSel();
      if (!sel.length) return;
      const c = sel.length === 1 ? { x: sel[0].x, y: sel[0].y } : G.bboxCenter(groupBBox(sel));
      const r = deg * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
      const m = new Map(sel.map(o => {
        const dx = o.x - c.x, dy = o.y - c.y;
        let rot = (o.rotation + deg) % 360; if (rot > 180) rot -= 360; if (rot <= -180) rot += 360;
        return [o.id, { x: c.x + dx * cs - dy * sn, y: c.y + dx * sn + dy * cs, rotation: rot }];
      }));
      S.updateMany(m);
    },
    align(how, target = 'paper') {
      const sel = editableSel();
      if (!sel.length) return;
      const bb = groupBBox(sel);
      if (!bb) return;
      let T;
      if (target === 'paper' && S.project.paper.visible) { const p = S.project.paper; T = { minX: p.x, minY: p.y, maxX: p.x + p.w, maxY: p.y + p.h }; }
      else if (target === 'work') T = App.workArea();
      else T = PP.GCode.reachableRect(App.profile());
      let dx = 0, dy = 0;
      const cx = (T.minX + T.maxX) / 2, cy = (T.minY + T.maxY) / 2;
      if (how === 'center' || how === 'hcenter') dx = cx - (bb.minX + bb.maxX) / 2;
      if (how === 'center' || how === 'vcenter') dy = cy - (bb.minY + bb.maxY) / 2;
      if (how === 'left') dx = T.minX - bb.minX;
      if (how === 'right') dx = T.maxX - bb.maxX;
      if (how === 'bottom') dy = T.minY - bb.minY;
      if (how === 'top') dy = T.maxY - bb.maxY;
      const m = new Map(sel.map(o => [o.id, { x: o.x + dx, y: o.y + dy }]));
      S.updateMany(m);
    },
    /** target 'work': the drawable part of the paper (the default); 'paper': the whole sheet, centered on it. */
    fit(margin = 10, target = 'work') {
      const sel = editableSel();
      if (!sel.length) return;
      const bb = groupBBox(sel);
      const pa = S.project.paper;
      const T = target === 'paper' && pa.visible ? { minX: pa.x, minY: pa.y, maxX: pa.x + pa.w, maxY: pa.y + pa.h } : App.workArea();
      const aw = T.maxX - T.minX - 2 * margin, ah = T.maxY - T.minY - 2 * margin;
      if (aw <= 1 || ah <= 1) return;
      const k = Math.min(aw / Math.max(0.01, bb.maxX - bb.minX), ah / Math.max(0.01, bb.maxY - bb.minY));
      const c0 = G.bboxCenter(bb), c1 = { x: (T.minX + T.maxX) / 2, y: (T.minY + T.maxY) / 2 };
      const m = new Map(sel.map(o => [o.id, { x: c1.x + (o.x - c0.x) * k, y: c1.y + (o.y - c0.y) * k, scaleX: o.scaleX * k, scaleY: o.scaleY * k }]));
      S.updateMany(m);
    },
    toPath() {
      const sel = editableSel().filter(o => o.type !== 'path' || (o.fill && o.fill.enabled) || o.rotation || o.scaleX !== 1 || o.scaleY !== 1);
      if (!sel.length) return;
      S.checkpoint();
      for (const o of sel) S.replace(o.id, OBJ.toPath(o), { history: false });
      S.events.emit('selection');
    },
    combine() {
      const sel = editableSel();
      if (sel.length < 2) return;
      const polys = [];
      for (const o of sel) for (const q of OBJ.world(o).polys) polys.push(q);
      const combined = OBJ.create.path(polys, { name: 'Combined', layerId: sel[0].layerId });
      S.checkpoint();
      S.remove(sel.map(o => o.id), { history: false });
      S.add(combined, { history: false, layerId: sel[0].layerId });
    },
    moveToLayer(layerId) {
      const sel = editableSel();
      if (!sel.length || !S.layer(layerId)) return;
      S.updateMany(new Map(sel.map(o => [o.id, { layerId }])));
    },
    toggleLock() {
      const sel = S.selected();
      if (!sel.length) return;
      const lock = !sel.every(o => o.locked);
      S.updateMany(new Map(sel.map(o => [o.id, { locked: lock }])));
    },
  };

  // ---------------------------------------------------------------------------
  // Files
  // ---------------------------------------------------------------------------
  // Where Save writes without asking: a file handle (browsers with the File System Access API), or the desktop
  // app's current file, which only the desktop shell knows. Opening, Save as and New change it.
  let fileHandle = null;
  const desktopFiles = () => window.ppDesktop && window.ppDesktop.saveProject ? window.ppDesktop : null;
  const PROJECT_TYPES = [{ description: 'DaVinci project', accept: { 'application/x-davinci': ['.davinci'] } }];
  const projectBase = (name) => String(name || '').replace(/\.davinci$/i, '');

  async function projectBytes() {
    return (await U.gzip(JSON.stringify(S.serialize()))).buffer;
  }

  /** Open a .davinci project's bytes; `name` is the file name it came from. */
  function loadProject(bytes, name) {
    return U.gunzipText(bytes).then(JSON.parse, (e) => { throw new Error('This is not a DaVinci project file.', { cause: e }); }).then((data) => {
      const { dropped } = S.load(data);
      S.dirty = false;
      App.view.fit();
      PP.UI.toast('Opened "' + (S.project.name || name) + '"' + (dropped ? ' - skipped ' + dropped + ' damaged object(s)' : ''), dropped ? 'warn' : 'info');
    });
  }

  App.files = {
    async newProject() {
      if (S.project.objects.length) {
        const ok = await PP.UI.confirm('New project', 'Start a new, empty project? You can undo this with Ctrl+Z.', 'New project');
        if (!ok) return;
      }
      fileHandle = null;
      if (desktopFiles()) desktopFiles().closeProject();
      S.reset();
    },
    // .davinci = the project JSON, gzipped. Save writes to the file the project came from; Save as (or a project
    // without one) asks where. A file name other than the suggested one renames the project.
    async saveProject({ saveAs = false } = {}) {
      const suggested = U.safeFilename(S.project.name, 'plot') + '.davinci';
      const named = (fileName) => {
        const base = projectBase(fileName).trim();
        if (!base || base === projectBase(suggested) || base === S.project.name) return false;
        S.project.name = base;
        S.changed('name');
        return true;
      };
      try {
        const desk = desktopFiles();
        let where = '';
        if (desk) {
          const r = await desk.saveProject(await projectBytes(), { name: suggested, saveAs });
          if (!r || r.canceled) return;
          if (r.chosen && named(r.name)) await desk.saveProject(await projectBytes(), {});
          where = ' as ' + r.name;
        } else if (window.showSaveFilePicker) {
          if (saveAs || !fileHandle) {
            try { fileHandle = await window.showSaveFilePicker({ suggestedName: suggested, types: PROJECT_TYPES }); }
            catch (e) { if (e.name === 'AbortError') return; throw e; }
            named(fileHandle.name);
          }
          const w = await fileHandle.createWritable();
          await w.write(await projectBytes());
          await w.close();
          where = ' as ' + fileHandle.name;
        } else {
          let name = suggested;
          if (saveAs) {
            const base = await PP.UI.prompt('Save as', 'File name', projectBase(suggested), 'Save');
            if (base === null) return;
            named(base);
            name = U.safeFilename(projectBase(base) || S.project.name, 'plot') + '.davinci';
          }
          await U.saveFiles([{ name, data: await projectBytes(), type: 'application/octet-stream' }]);
          where = ' to your downloads folder';
        }
        S.dirty = false;
        PP.UI.toast('Project saved' + where, 'info');
      } catch (e) { PP.UI.toast('Could not save the project: ' + e.message, 'error'); }
    },
    /** Open a project: the given File (drag and drop, the file manager), or ask for one. */
    async openProject(file) {
      try {
        const desk = desktopFiles();
        if (file) {
          fileHandle = null;
          if (desk) desk.closeProject();
          await loadProject(await U.readFile(file, 'arraybuffer'), file.name);
        } else if (desk) {
          const f = await desk.openProject();
          if (!f) return;
          await loadProject(f.data, f.name).catch((e) => { desk.closeProject(); throw e; });
        } else if (window.showOpenFilePicker) {
          let handle;
          try { [handle] = await window.showOpenFilePicker({ types: PROJECT_TYPES, excludeAcceptAllOption: false }); }
          catch (e) { if (e.name === 'AbortError') return; throw e; }
          await loadProject(await (await handle.getFile()).arrayBuffer(), handle.name);
          fileHandle = handle;
        } else {
          const f = await U.pickFile('.davinci');
          if (!f) return;
          fileHandle = null;
          await loadProject(await U.readFile(f, 'arraybuffer'), f.name);
        }
      } catch (e) { PP.UI.toast('Could not open the project: ' + e.message, 'error'); }
    },
    async importSVG(file, opts = {}) {
      file = file || await U.pickFile('.svg,image/svg+xml');
      if (!file) return;
      try {
        const text = await U.readFile(file, 'text');
        const res = PP.SVG.importSVG(text);
        const groups = res.groups.filter(g => g.polys.length);
        if (!groups.length) { PP.UI.toast('No drawable paths were found in that SVG.', 'warn'); return; }
        const split = opts.splitColors !== undefined ? opts.splitColors : PP.UI.importPrefs().splitColors;
        const fill = opts.fillShapes !== undefined ? opts.fillShapes : PP.UI.importPrefs().fillShapes;
        const base = file.name.replace(/\.svg$/i, '');
        if (!split && !App.requireEditableLayer()) return; // one object onto the active layer
        S.checkpoint();
        const objs = [];
        if (split && groups.length > 1) {
          groups.forEach((g, i) => {
            let L = S.project.layers.find(l => l.color.toLowerCase() === g.color && !S.project.objects.some(o => o.layerId === l.id));
            if (!L) {
              const nl = { id: U.uid('l'), name: base + ' ' + g.color, color: g.color, visible: true, locked: false, penWidth: 0.5, zDraw: null, speed: null };
              S.project.layers.push(nl);
              L = nl;
            }
            objs.push(OBJ.create.path(g.polys, { name: base + ' (' + g.color + ')', layerId: L.id, fill: fill && g.filled ? Object.assign({}, OBJ.DEFAULT_FILL, { enabled: true }) : null }));
          });
        } else {
          const all = [];
          groups.forEach(g => g.polys.forEach(p => all.push(p)));
          const anyFilled = groups.some(g => g.filled);
          objs.push(OBJ.create.path(all, { name: base, fill: fill && anyFilled ? Object.assign({}, OBJ.DEFAULT_FILL, { enabled: true }) : null }));
        }
        App.addPlaced(objs, { history: false, keepLayers: true, layerId: null, fit: opts.fit });
        res.warnings.forEach(w => PP.UI.toast(w, 'warn', 7000));
        PP.UI.toast('Imported ' + file.name, 'info');
      } catch (e) {
        console.error(e);
        PP.UI.toast('SVG import failed: ' + e.message, 'error');
      }
    },
    exportSVG() {
      const layers = [];
      for (const L of S.project.layers) {
        if (!L.visible) continue;
        const polys = [];
        for (const o of S.project.objects) if (o.layerId === L.id) for (const q of OBJ.world(o).polys) polys.push(q);
        if (polys.length) layers.push({ name: L.name, color: L.color, width: L.penWidth, polys });
      }
      if (!layers.length) { PP.UI.toast('Nothing to export yet.', 'warn'); return; }
      const p = App.profile();
      U.saveFiles([{ name: U.safeFilename(S.project.name, 'plot') + '.svg', data: PP.SVG.exportSVG(layers, p.bedWidth, p.bedDepth), type: 'image/svg+xml' }])
        .catch((e) => PP.UI.toast('Could not save the SVG: ' + e.message, 'error'));
    },
    async handleFiles(files) {
      for (const f of files) {
        const n = f.name.toLowerCase();
        if (n.endsWith('.svg')) await App.files.importSVG(f);
        else if (n.endsWith('.davinci')) await App.files.openProject(f);
        else if (n.endsWith('.ttf') || n.endsWith('.otf') || n.endsWith('.woff')) await PP.UI.uploadFont(f);
        else if (/^image\//.test(f.type) || /\.(png|jpe?g|gif|bmp|webp)$/.test(n)) PP.UI.openImageTrace(f);
        else PP.UI.toast('Unsupported file: ' + f.name, 'warn');
      }
    },
  };

  // ---------------------------------------------------------------------------
  // Header, tool strip, status bar
  // ---------------------------------------------------------------------------
  const TOOLS = [
    { id: 'select', icon: 'select', label: 'Select / move', key: 'V' },
    { id: 'pan', icon: 'pan', label: 'Pan (or hold Space)', key: 'H' },
    { sep: true },
    { id: 'pen', icon: 'pen', label: 'Freehand pen', key: 'P' },
    { id: 'line', icon: 'line', label: 'Line', key: 'L' },
    { id: 'polyline', icon: 'polyline', label: 'Polyline (click points, double-click to finish)', key: 'Y' },
    { id: 'curve', icon: 'curve', label: 'Smooth curve (click points, double-click to finish)', key: 'C' },
    { sep: true },
    { id: 'rect', icon: 'rect', label: 'Rectangle', key: 'R' },
    { id: 'ellipse', icon: 'ellipse', label: 'Ellipse / circle', key: 'E' },
    { id: 'polygon', icon: 'polygon', label: 'Polygon', key: 'G' },
    { id: 'star', icon: 'star', label: 'Star', key: 'S' },
    { sep: true },
    { id: 'text', icon: 'text', label: 'Text', key: 'T' },
    { id: 'eraser', icon: 'eraser', label: 'Eraser', key: 'X' },
  ];
  App.TOOLS = TOOLS;

  App.setTool = function (id) {
    App.view.setTool(id);
    U.$$('.tool-btn').forEach(b => b.classList.toggle('on', b.dataset.tool === id));
    events.emit('tool', id);
  };

  function buildToolStrip() {
    const strip = U.$('#toolstrip');
    for (const t of TOOLS) {
      if (t.sep) { strip.appendChild(h('div', { class: 'tsep' })); continue; }
      const b = h('button', { class: 'tool-btn', title: t.label + ' (' + t.key + ')', 'aria-label': t.label, dataset: { tool: t.id }, onclick: () => App.setTool(t.id) }, PP.UI.icon(t.icon, 20));
      strip.appendChild(b);
    }
  }

  function buildCanvasControls() {
    const host = U.$('#canvas-wrap');
    const UI = PP.UI;
    const zoomLbl = h('span', { class: 'zoom-lbl' }, '100%');
    const ctr = h('div', { class: 'canvas-ctrls' },
      UI.iconBtn('zoomout', 'Zoom out (-)', () => App.view.zoomBy(1 / 1.25)),
      zoomLbl,
      UI.iconBtn('zoomin', 'Zoom in (+)', () => App.view.zoomBy(1.25)),
      UI.iconBtn('fit', 'Fit bed (0)', () => App.view.fit()));
    host.appendChild(ctr);
    App.view.events.on('zoom', (z) => { zoomLbl.textContent = Math.round(z / (App.view._fitZoom || z) * 100) + '%'; });
    App.view._fitZoom = App.view.zoom;
    const origFit = App.view.fit.bind(App.view);
    App.view.fit = function () { origFit(); App.view._fitZoom = App.view.zoom; zoomLbl.textContent = '100%'; };
  }

  // Settings of the active tool, in a small bar on the canvas (the tools themselves are in the tool strip).
  // Tools without settings hide it; how to use a tool is in the status bar.
  function buildToolOptions() {
    const UI = PP.UI, ds = App.drawSettings;
    const set = (k) => (v) => { ds[k] = v; App.saveDrawSettings(); App.view.invalidate(); };
    const F = (k, label, o) => UI.numberField(Object.assign({ label, value: ds[k], onChange: set(k), onInput: set(k) }, o));
    const OPTS = {
      pen: () => [F('smoothing', 'Smoothing', { min: 0, max: 4 })],
      rect: () => [F('cornerRadius', 'Corner radius', { unit: 'mm', min: 0, max: 50, step: 0.5, decimals: 1 })],
      polygon: () => [F('sides', 'Sides', { min: 3, max: 24 })],
      star: () => [F('starPoints', 'Points', { min: 3, max: 24 }), F('starInner', 'Inner radius', { unit: '×', min: 0.1, max: 0.9, step: 0.05, decimals: 2 })],
      eraser: () => [F('eraserSize', 'Size', { unit: 'mm', min: 0.5, max: 40, step: 0.5, decimals: 1 })],
    };
    const bar = h('div', { class: 'tool-opts', role: 'toolbar', 'aria-label': 'Tool settings' });
    bar.hidden = true;
    U.$('#canvas-wrap').appendChild(bar);
    events.on('tool', (id) => {
      U.clear(bar);
      const t = TOOLS.find(x => x.id === id);
      bar.hidden = !OPTS[id];
      if (OPTS[id]) bar.append(h('span', { class: 'tool-opts-name' }, PP.UI.icon(t.icon, 15), t.label), ...OPTS[id]());
    });
  }

  function buildStatusBar() {
    const UI = PP.UI;
    const bar = U.$('#statusbar');
    const pos = h('span', { class: 'st-pos' }, 'X —  Y —');
    const noz = h('span', { class: 'st-noz', title: 'Where the NOZZLE will be when the pen is at the cursor' }, '');
    const hint = h('span', { class: 'st-hint' }, '');
    const sel = h('span', { class: 'st-sel' }, '');

    // the printer and the paper: what the plot is set up for, one click from changing
    const printerLbl = h('span', null, App.profile().name);
    const printer = h('button', { class: 'st-chip st-printer', title: 'Printer', 'aria-label': 'Printer: ' + App.profile().name },
      UI.icon('printer', 13), printerLbl, UI.icon('chevron', 11));
    printer.addEventListener('click', () => UI.menu(printer, PP.Menus.resolve(PP.Menus.MENUS.find(m => m.id === 'printer')), { align: 'right' }));
    events.on('profile', () => { printerLbl.textContent = App.profile().name; printer.setAttribute('aria-label', 'Printer: ' + App.profile().name); });

    const paperLbl = h('span', null, UI.paperLabel());
    const paper = h('button', { class: 'st-chip st-paper', title: 'Paper size and position' }, UI.icon('paper', 13), paperLbl, UI.icon('chevron', 11));
    paper.addEventListener('click', () => UI.openPaper(paper));
    S.events.on('change', (k) => { if (k === 'paper' || k === 'load' || k === 'undo' || k === 'redo') paperLbl.textContent = UI.paperLabel(); });

    bar.append(pos, noz, sel, hint, h('span', { class: 'hspacer' }), printer, paper);

    App.view.events.on('cursor', (w) => {
      if (!w) { pos.textContent = 'X —  Y —'; noz.textContent = ''; return; }
      const p = App.profile();
      pos.textContent = 'Pen X ' + w.x.toFixed(1) + '  Y ' + w.y.toFixed(1) + ' mm';
      noz.textContent = 'Nozzle X ' + (w.x - p.penOffsetX).toFixed(1) + '  Y ' + (w.y - p.penOffsetY).toFixed(1);
    });
    const defaultHint = () => {
      const tips = {
        select: '',
        pan: 'Drag to pan • scroll to zoom',
        pen: 'Drag to draw freehand',
        line: 'Drag to draw a line • Shift snaps to 15°',
        polyline: 'Click to add points • double-click or Enter to finish • click the first point to close • Backspace removes a point',
        curve: 'Click to add points for a smooth curve • double-click or Enter to finish',
        rect: 'Drag to draw • Shift = square • Alt = from center',
        ellipse: 'Drag to draw • Shift = circle • Alt = from center',
        polygon: 'Drag to draw',
        star: 'Drag to draw',
        text: 'Click on the bed to place text',
        eraser: 'Drag over lines to erase',
      };
      hint.textContent = tips[App.view.toolId] || '';
    };
    App.view.events.on('tool', defaultHint);
    App.view.events.on('hint', (t) => { if (t) hint.textContent = t; else defaultHint(); });
    const updSel = () => {
      const n = S.selection.length;
      sel.textContent = n ? n + ' selected' : '';
    };
    S.events.on('selection', updSel);
  }

  /** The bottom of the right panel: what the plot takes, whether it is ready, Preview and Export G-code. */
  function buildPlotBar(host) {
    const UI = PP.UI;
    const plan = h('div', { class: 'plot-sum' }, '');
    const check = h('button', { class: 'plot-check ok', onclick: () => showChecks() }, '');
    const preview = UI.btn('Preview', () => PP.Preview.toggle(), { icon: 'play', title: 'Animate the simulated G-code' });
    host.appendChild(h('div', { class: 'plot-bar' },
      h('div', { class: 'plot-status' }, plan, check),
      h('div', { class: 'plot-actions' }, preview,
        UI.btn('Export G-code', () => UI.openExport(), { icon: 'download', primary: true, title: 'Export G-code (' + PP.Menus.keyLabel('Mod+E') + ')' }))));
    events.on('preview', (on) => preview.classList.toggle('on', on));

    let notes = [];
    let chipPop = null;
    const summarizeNow = () => {
      if (chipPop) { chipPop.close(); chipPop = null; }
      let pl;
      try { pl = App.buildPlan(); } catch (e) { console.error(e); return; }
      const st = pl.stats, n = pl.jobs.length;
      U.clear(plan);
      if (!n) plan.textContent = 'Nothing to plot yet';
      // each figure stays on one line when the summary wraps
      else ['≈ ' + U.formatDuration(st.time + 45), n + (n === 1 ? ' pen' : ' pens'), U.formatLength(st.drawLen) + ' of line', st.lifts + ' lifts']
        .forEach((t, i) => plan.append(i ? ' · ' : '', h('span', null, t)));
      notes = [];
      if (!n) notes.push(['info', App.emptyPlanMessage(pl)]);
      else if (pl.clipped) notes.push(['warn', 'Some lines are outside the drawable area (shown in red) and will be clipped.']);
      const hidden = S.project.layers.filter(l => !l.visible && S.project.objects.some(o => o.layerId === l.id));
      if (hidden.length) notes.push(['info', hidden.length + ' hidden layer(s) will not be plotted.']);
      PP.GCode.validateProfile(pl.profile).forEach(e => notes.push(['error', e]));
      const worst = notes.some(x => x[0] === 'error') ? 'error' : notes.some(x => x[0] === 'warn') ? 'warn' : notes.length ? 'info' : 'ok';
      check.className = 'plot-check ' + worst;
      U.clear(check);
      check.append(UI.icon(worst === 'ok' ? 'check' : worst === 'info' ? 'help' : 'warn', 12),
        h('span', null, worst === 'ok' ? 'Ready to plot' : !n && notes.length === 1 ? 'Nothing to plot' : notes.length + (notes.length === 1 ? ' note' : ' notes')));
    };
    const summarize = U.debounce(summarizeNow, 300);
    function showChecks() {
      if (!notes.length) return;
      chipPop = UI.popover(check, h('div', { class: 'warns popover-pad' }, notes.map(([t, m]) => h('div', { class: 'warn-item ' + t }, UI.icon(t === 'info' ? 'help' : 'warn', 14), h('span', null, m)))), { align: 'right' });
    }
    S.events.on('change', summarize); events.on('profile', summarize); events.on('prefs', summarize);
    summarizeNow();
  }

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------
  function isTyping(e) {
    const t = e.target;
    if (!t) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  }

  function onKeyDown(e) {
    const view = App.view;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      if (PP.UI.closeTopModal()) { e.preventDefault(); return; }
      if (isTyping(e)) { e.target.blur(); return; }
      if (PP.Preview.active) { PP.Preview.stop(); return; }
      if (view.tool && view.tool.key && view.tool.key(e)) return;
      if (view.toolId !== 'select') { App.setTool('select'); return; }
      S.clearSelection();
      return;
    }
    if (PP.UI.hasModal()) return;
    if (isTyping(e)) return;
    if (document.querySelector('.popover')) return; // a menu is open: keys belong to it
    if (PP.Preview.active) return; // no editing while previewing (Escape closes the preview)

    if (view.tool && view.tool.key && view.tool.key(e)) { e.preventDefault(); view.invalidate(); return; }

    const k = e.key.toLowerCase();
    if (mod) {
      if (k === 'z' && !e.shiftKey) { S.undo(); e.preventDefault(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { S.redo(); e.preventDefault(); }
      else if (k === 'd') { App.ops.duplicate(); e.preventDefault(); }
      else if (k === 'c') { App.ops.copy(); e.preventDefault(); }
      else if (k === 'x') { App.ops.cut(); e.preventDefault(); }
      else if (k === 'v') { App.ops.paste(); e.preventDefault(); }
      else if (k === 'a') { App.ops.selectAll(); e.preventDefault(); }
      else if (k === '0') { view.fit(); e.preventDefault(); }
      return;
    }
    if (e.key === ' ') {
      if (e.target && e.target.closest && e.target.closest('button')) return; // Space presses a focused button
      if (!view.spaceDown) { view.spaceDown = true; view.canvas.style.cursor = 'grab'; }
      e.preventDefault();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { App.ops.remove(); e.preventDefault(); return; }
    if (e.key.startsWith('Arrow')) {
      const step = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
      App.ops.nudge(d[0], d[1]);
      e.preventDefault();
      return;
    }
    if (e.key === '+' || e.key === '=') { view.zoomBy(1.25); return; }
    if (e.key === '-' || e.key === '_') { view.zoomBy(1 / 1.25); return; }
    if (e.key === '0') { view.fit(); return; }
    const t = TOOLS.find(t => t.key && t.key.toLowerCase() === k);
    if (t) { App.setTool(t.id); e.preventDefault(); }
  }

  function onKeyUp(e) {
    if (e.key === ' ' && App.view.spaceDown) {
      App.view.spaceDown = false;
      App.view.canvas.style.cursor = App.view.toolId === 'pan' ? 'grab' : (App.view.tool.cursor || 'default');
    }
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  App.init = async function () {
    if (!PP.UI.initNativeMenu()) PP.UI.buildMenuBar(U.$('#menubar'));
    const title = () => { document.title = S.project.name + ' — DaVinci'; };
    S.events.on('change', (k) => { if (k === 'name' || k === 'load' || k === 'undo' || k === 'redo') title(); });
    title();
    buildToolStrip();
    App.view = new PP.View(U.$('#canvas-wrap'));
    PP.installTools(App.view);
    buildCanvasControls();
    buildToolOptions();
    buildStatusBar();
    PP.Preview.init(App.view);
    PP.UI.buildLeftPanel(U.$('#left-panel'));
    const right = U.$('#right-panel'), panels = h('div', { class: 'rp-body' });
    right.appendChild(panels);
    PP.UI.buildRightPanel(panels);
    buildPlotBar(right);
    App.setTool('select');

    document.addEventListener('keydown', onKeyDown);
    // an emptied text object has nothing to click: remove it once it is deselected
    let prevSel = [];
    S.events.on('selection', () => {
      const gone = prevSel.filter(id => !S.selection.includes(id)).map(id => S.get(id))
        .filter(o => o && o.type === 'text' && !String(o.text || '').trim());
      prevSel = S.selection.slice();
      if (gone.length) S.remove(gone.map(o => o.id), { history: false }); // undo brings the text back, not an empty object
    });
    // The file shortcuts (Save, Open, Export...) work everywhere, even while typing in a field (fields stop keydown
    // propagation). Capture phase, before those fields; blurring commits the field's value first.
    window.addEventListener('keydown', (e) => {
      const id = PP.Menus.globalCommand(e);
      if (!id) return;
      e.preventDefault(); // never the browser's own Save page / Open file
      if (PP.UI.hasModal()) return;
      e.stopPropagation();
      if (isTyping({ target: document.activeElement })) document.activeElement.blur();
      PP.Menus.run(id);
    }, true);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', () => { if (App.view.spaceDown) { App.view.spaceDown = false; } });

    // drag & drop
    const dropMask = h('div', { class: 'drop-mask' }, h('div', null, PP.UI.icon('upload', 36), h('p', null, 'Drop SVG, image, font or project file')));
    document.body.appendChild(dropMask);
    let dragDepth = 0;
    document.addEventListener('dragenter', (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) { dragDepth++; dropMask.classList.add('show'); } });
    document.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropMask.classList.remove('show'); });
    document.addEventListener('dragover', (e) => { e.preventDefault(); });
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      dragDepth = 0; dropMask.classList.remove('show');
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      if (files.length) App.files.handleFiles(files);
    });
    // autosave is debounced: write the last edit before the tab is hidden or closed
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') S.flushAutosave(); });
    window.addEventListener('pagehide', () => S.flushAutosave());

    // Preload the default font, restore uploaded fonts and the last session
    // before the autosave: text in an installed font would otherwise be laid out in the fallback font
    await PP.Fonts.restoreSystemFonts();
    PP.Fonts.load(PP.Fonts.DEFAULT).catch((e) => PP.UI.toast('Could not load the Hershey fonts (' + e.message + '). Check your internet connection - text needs them.', 'error', 8000));
    PP.Fonts.restoreCustomFonts();
    const restored = await S.restoreAutosave();
    if (!restored) PP.UI.loadWelcomeDesign();
    App.view.fit();
    App.view.invalidate();
    if (!PP.Storage.getLocal('seenHelp', false)) {
      PP.Storage.setLocal('seenHelp', true);
      setTimeout(() => PP.UI.openHelp(), 400);
    }
    // desktop app: a .davinci double-clicked in the file manager (at launch, or while the app is open). The shell
    // makes it the current file, so Save writes back to it.
    const desk = window.ppDesktop;
    if (desk && desk.takeOpenFile) {
      const open = (f) => {
        if (f) loadProject(f.data, f.name).catch((e) => { desk.closeProject(); PP.UI.toast('Could not open the project: ' + e.message, 'error'); });
      };
      desk.onOpenFile(open);
      desk.takeOpenFile().then(open, (e) => PP.UI.toast('Could not open the file: ' + e.message, 'error'));
    }
  };

  PP.App = App;
})(window.PP = window.PP || {});
