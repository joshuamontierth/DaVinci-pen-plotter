/*
 * DaVinci - the menu bar (File, Edit, View, Printer, Help), its keyboard shortcuts, and the same menus as the
 * desktop app's native menu. Commands are defined once here; the page draws them as dropdowns, or hands them to
 * the desktop shell (preload.js), which shows them in the window's own menu bar and sends the clicks back.
 */
(function (PP) {
  'use strict';

  const U = PP.U, S = PP.Store, h = U.h;
  const UI = PP.UI;
  const MAC = /Mac|iPhone|iPad/.test(navigator.platform || '');
  const GITHUB = 'https://github.com/joshuamontierth/DaVinci-pen-plotter';
  const desk = () => window.ppDesktop && window.ppDesktop.setMenu ? window.ppDesktop : null;

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------
  // keys: 'Mod+Shift+S' (Mod = Ctrl, or Cmd on a Mac). global: the shortcut works while typing in a field too.
  // Mod+N belongs to the browser (a new window) and only reaches the desktop app.
  const App = () => PP.App;
  const hasSel = () => S.selection.length > 0;
  const COMMANDS = {
    new: { label: 'New project', keys: 'Mod+N', desktopKeys: true, global: true, run: () => App().files.newProject() },
    open: { label: 'Open…', keys: 'Mod+O', global: true, run: () => App().files.openProject() },
    save: { label: 'Save', keys: 'Mod+S', global: true, run: () => App().files.saveProject() },
    saveAs: { label: 'Save as…', keys: 'Mod+Shift+S', global: true, run: () => App().files.saveProject({ saveAs: true }) },
    importSvg: { label: 'Import SVG…', keys: 'Mod+I', global: true, run: () => App().files.importSVG() },
    exportSvg: { label: 'Export SVG…', keys: 'Mod+Shift+E', global: true, run: () => App().files.exportSVG() },
    exportGcode: { label: 'Export G-code…', keys: 'Mod+E', global: true, run: () => UI.openExport() },
    paper: { label: 'Paper…', run: () => UI.openPaper() },
    penMount: { label: 'Download pen mount…', run: () => UI.openPenHolder() },

    undo: { label: 'Undo', keys: 'Mod+Z', run: () => S.undo(), enabled: () => S.undoStack.length > 0 },
    redo: { label: 'Redo', keys: 'Mod+Shift+Z', run: () => S.redo(), enabled: () => S.redoStack.length > 0 },
    cut: { label: 'Cut', keys: 'Mod+X', run: () => App().ops.cut(), enabled: hasSel },
    copy: { label: 'Copy', keys: 'Mod+C', run: () => App().ops.copy(), enabled: hasSel },
    paste: { label: 'Paste', keys: 'Mod+V', run: () => App().ops.paste(), enabled: () => !!App().clipboard },
    duplicate: { label: 'Duplicate', keys: 'Mod+D', run: () => App().ops.duplicate(), enabled: hasSel },
    delete: { label: 'Delete', keys: 'Del', run: () => App().ops.remove(), enabled: hasSel },
    selectAll: { label: 'Select all', keys: 'Mod+A', run: () => App().ops.selectAll(), enabled: () => S.project.objects.length > 0 },

    zoomIn: { label: 'Zoom in', keys: '+', run: () => App().view.zoomBy(1.25) },
    zoomOut: { label: 'Zoom out', keys: '-', run: () => App().view.zoomBy(1 / 1.25) },
    fit: { label: 'Fit bed', keys: '0', run: () => App().view.fit() },
    preview: { label: 'Preview plot', type: 'checkbox', run: () => PP.Preview.toggle(), checked: () => PP.Preview.active },

    printerSettings: { label: 'Printer settings…', keys: 'Mod+,', global: true, run: () => UI.openPrinterSettings() },
    calibrate: { label: 'Calibrate…', run: () => UI.openCalibration() },

    helpStart: { label: 'Getting started', run: () => UI.openHelp('start'), help: true },
    helpCalibration: { label: 'Calibration guide', run: () => UI.openHelp('calibration'), help: true },
    helpSafety: { label: 'Safety', run: () => UI.openHelp('safety'), help: true },
    helpShortcuts: { label: 'Keyboard shortcuts', run: () => UI.openHelp('shortcuts'), help: true },
    website: { label: 'DaVinci on GitHub', run: () => window.open(GITHUB, '_blank', 'noopener'), help: true },
    about: { label: 'About DaVinci', run: () => UI.openAbout(), help: true },
  };

  /** One radio item per printer profile: presets, then the user's own. */
  function printerItems() {
    const list = App().profiles(), active = App().profile().id;
    const item = (p) => ({ id: 'printer:' + p.id, label: p.name, type: 'radio', checked: p.id === active });
    const own = list.filter(p => !p.builtin);
    return [...list.filter(p => p.builtin).map(item), ...(own.length ? ['-', ...own.map(item)] : [])];
  }

  const MENUS = [
    { id: 'file', label: 'File', items: () => ['new', 'open', '-', 'save', 'saveAs', '-', 'importSvg', 'exportSvg', 'exportGcode', '-', 'paper', 'penMount'] },
    { id: 'edit', label: 'Edit', items: () => ['undo', 'redo', '-', 'cut', 'copy', 'paste', 'duplicate', 'delete', '-', 'selectAll'] },
    { id: 'view', label: 'View', items: () => ['zoomIn', 'zoomOut', 'fit', '-', 'preview'] },
    { id: 'printer', label: 'Printer', items: () => [...printerItems(), '-', 'printerSettings', 'calibrate'] },
    { id: 'help', label: 'Help', items: () => ['helpStart', 'helpCalibration', 'helpSafety', 'helpShortcuts', '-', 'website', 'about'] },
  ];

  /** A menu's items, resolved: '-' or { id, label, keys, type, enabled, checked }. */
  function resolve(menu) {
    return menu.items().map((it) => {
      if (it === '-') return it;
      if (typeof it === 'object') return Object.assign({ enabled: true }, it);
      const c = COMMANDS[it];
      return {
        id: it, label: c.label, type: c.type || 'normal',
        keys: c.desktopKeys && !desk() ? null : c.keys || null,
        enabled: c.enabled ? !!c.enabled() : true,
        checked: c.checked ? !!c.checked() : false,
        help: !!c.help,
      };
    });
  }

  /** Run a command by id. Menus close first, so a command that opens a dialog or popover starts clean. */
  function run(id) {
    UI.closePopover();
    if (id.startsWith('printer:')) { App().setProfile(id.slice(8)); return; }
    const c = COMMANDS[id];
    if (!c || (c.enabled && !c.enabled())) return;
    c.run();
  }

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------
  /** 'Mod+Shift+S' -> { mods: ['Mod', 'Shift'], key: 'S' }; the key itself may be '+'. */
  function parseKeys(keys) {
    const m = /^((?:(?:Mod|Shift|Alt)\+)*)(.+)$/.exec(keys);
    return { mods: m[1].split('+').filter(Boolean), key: m[2] };
  }

  /** "Ctrl+Shift+S" on Windows and Linux, "⇧⌘S" on a Mac. */
  function keyLabel(keys) {
    if (!keys) return '';
    const { mods, key } = parseKeys(keys);
    const k = { '-': '−', Del: MAC ? '⌫' : 'Del' }[key] || key;
    if (MAC) return (mods.includes('Shift') ? '⇧' : '') + (mods.includes('Alt') ? '⌥' : '') + (mods.includes('Mod') ? '⌘' : '') + k;
    return [...mods.map(m => (m === 'Mod' ? 'Ctrl' : m)), k].join('+');
  }

  /** The keys for aria-keyshortcuts ("Control+Shift+S"). */
  function ariaKeys(keys) {
    if (!keys) return null;
    const { mods, key } = parseKeys(keys);
    return [...mods.map(m => (m === 'Mod' ? (MAC ? 'Meta' : 'Control') : m)), { Del: 'Delete' }[key] || key].join('+');
  }

  /** The keys as an Electron accelerator ("CmdOrCtrl+Shift+S"). */
  function accelerator(keys) {
    if (!keys) return undefined;
    const { mods, key } = parseKeys(keys);
    return [...mods.map(m => (m === 'Mod' ? 'CmdOrCtrl' : m)), { '+': 'Plus', Del: 'Delete' }[key] || key].join('+');
  }

  /** The command a keydown triggers among the shortcuts that work everywhere (Save, Open, Export...), or null. */
  function globalCommand(e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
    const key = e.key.toLowerCase();
    for (const [id, c] of Object.entries(COMMANDS)) {
      if (!c.global || !c.keys) continue;
      const { mods, key: k } = parseKeys(c.keys);
      if (mods.includes('Shift') === e.shiftKey && k.toLowerCase() === key) return id;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Dropdowns
  // ---------------------------------------------------------------------------
  /** A menu panel for UI.popover: buttons for the items, arrow keys move between them. */
  function menuPanel(items, onPick) {
    const panel = h('div', { class: 'menu dropdown', role: 'menu' });
    for (const it of items) {
      if (it === '-') { panel.appendChild(h('div', { class: 'menu-sep', role: 'separator' })); continue; }
      const role = it.type === 'radio' ? 'menuitemradio' : it.type === 'checkbox' ? 'menuitemcheckbox' : 'menuitem';
      const b = h('button', { class: 'mi' + (it.type === 'radio' ? ' radio' : ''), role, 'aria-label': it.label, 'aria-keyshortcuts': ariaKeys(it.keys), disabled: !it.enabled, dataset: { cmd: it.id }, onclick: () => onPick(it.id) },
        h('span', { class: 'mi-check', 'aria-hidden': 'true' }),
        h('span', { class: 'mi-label' }, it.label),
        it.keys ? h('kbd', { class: 'mi-keys' }, keyLabel(it.keys)) : null);
      if (it.type !== 'normal') b.setAttribute('aria-checked', String(!!it.checked));
      panel.appendChild(b);
    }
    panel.addEventListener('keydown', (e) => {
      const btns = U.$$('.mi:not(:disabled)', panel);
      const i = btns.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = btns.length, next = e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n;
        if (n) btns[i < 0 && e.key === 'ArrowUp' ? n - 1 : next].focus();
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        if (btns.length) btns[e.key === 'Home' ? 0 : btns.length - 1].focus();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        UI.closePopover();
      }
    });
    return panel;
  }

  /** Open a list of items as a dropdown under (or above) anchor. Returns the popover, or null if it toggled shut. */
  UI.menu = function (anchor, items, opts = {}) {
    return UI.popover(anchor, menuPanel(items, run), Object.assign({ className: 'menu-pop' }, opts));
  };

  // ---------------------------------------------------------------------------
  // The menu bar
  // ---------------------------------------------------------------------------
  let titles = [];
  let openId = null;
  let openPop = null;

  function focusFirstItem() {
    const first = openPop && U.$('.mi:not(:disabled)', openPop.el);
    if (first) first.focus();
  }

  function openMenu(id, focusFirst) {
    const menu = MENUS.find(m => m.id === id);
    const title = titles.find(t => t.dataset.menu === id);
    if (!menu || !title) return;
    if (openId === id) { UI.closePopover(); return; }
    let keyboard = !!focusFirst;
    const pop = UI.menu(title, resolve(menu), {
      onClose: () => {
        title.classList.remove('open');
        title.setAttribute('aria-expanded', 'false');
        if (openId === id) { openId = null; openPop = null; }
        // Escape or Tab from inside the menu hands the focus back to its title
        if (keyboard && (!document.activeElement || document.activeElement === document.body)) title.focus();
      },
    });
    if (!pop) return;
    openId = id;
    openPop = pop;
    pop.el.addEventListener('keydown', () => { keyboard = true; }, true);
    title.classList.add('open');
    title.setAttribute('aria-expanded', 'true');
    pop.el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const i = titles.indexOf(title), n = titles.length;
        openMenu(titles[(i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n].dataset.menu, true);
      }
    });
    if (focusFirst) focusFirstItem();
  }

  UI.buildMenuBar = function (host) {
    const nav = h('nav', { class: 'menus', role: 'menubar', 'aria-label': 'Main menu' });
    titles = MENUS.map((m) => {
      const b = h('button', { class: 'menu-title', role: 'menuitem', 'aria-haspopup': 'menu', 'aria-expanded': 'false', dataset: { menu: m.id } }, m.label);
      b.addEventListener('click', () => openMenu(m.id, false));
      // with a menu open, pointing at another title switches to it
      b.addEventListener('pointerenter', () => { if (openId && openId !== m.id) openMenu(m.id, false); });
      b.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || ((e.key === 'Enter' || e.key === ' ') && openId !== m.id)) {
          e.preventDefault();
          if (openId !== m.id) openMenu(m.id, true);
          else focusFirstItem();
        }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const i = titles.indexOf(b), n = titles.length;
          titles[(i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n].focus();
        }
      });
      nav.appendChild(b);
      return b;
    });

    const name = h('input', { class: 'project-name', value: S.project.name, title: 'Project name', 'aria-label': 'Project name', spellcheck: 'false' });
    name.addEventListener('change', () => { S.project.name = name.value.trim() || 'Untitled plot'; S.changed('name'); });
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') name.blur(); e.stopPropagation(); });
    S.events.on('change', () => { if (document.activeElement !== name) name.value = S.project.name; });

    host.append(
      h('div', { class: 'menubar-left' },
        h('div', { class: 'brand' }, h('img', { class: 'logo', src: 'assets/davinci.svg', width: 18, height: 18, alt: '' }), h('span', { class: 'brand-name' }, 'DaVinci')),
        nav),
      h('div', { class: 'doc-title' }, name),
    );
  };

  // ---------------------------------------------------------------------------
  // Desktop app: the native menu
  // ---------------------------------------------------------------------------
  /** The menus as plain data for the desktop shell. While a dialog is open only Help stays available. */
  function nativeModel() {
    const modal = UI.hasModal();
    return MENUS.map(m => ({
      id: m.id, label: m.label,
      items: resolve(m).map(it => it === '-' ? { type: 'separator' } : {
        id: it.id, label: it.label, type: it.type, checked: it.checked,
        accelerator: accelerator(it.keys), enabled: it.enabled && (!modal || it.help),
      }),
    }));
  }

  UI.initNativeMenu = function () {
    const d = desk();
    if (!d) return false;
    document.body.classList.add('native-menu');
    const sync = U.debounce(() => d.setMenu(nativeModel()), 30);
    d.onMenu((id) => { if (!UI.hasModal() || (COMMANDS[id] && COMMANDS[id].help)) { run(id); sync(); } });
    S.events.on('history', sync);
    S.events.on('selection', sync);
    S.events.on('change', (k) => { if (k === 'load') sync(); });
    App().events.on('profile', sync);
    App().events.on('preview', sync);
    App().events.on('clipboard', sync);
    UI.events.on('modal', sync);
    d.setMenu(nativeModel());
    return true;
  };

  PP.Menus = { COMMANDS, MENUS, run, resolve, keyLabel, accelerator, globalCommand, nativeModel };
})(window.PP = window.PP || {});
