'use strict';

// The window's native menu bar. The page owns the menus (src/js/ui/menubar.js): it sends them over as plain data
// whenever they change (preload.js setMenu) and gets the clicks back as command ids. Accelerators are shown but not
// registered, because the page handles its own shortcuts; Edit commands go to the text field when one has focus.

const { Menu } = require('electron');

// Edit commands that act on a focused text field instead of the drawing
const TEXT_EDIT = {
  undo: 'undo',
  redo: 'redo',
  cut: 'cut',
  copy: 'copy',
  paste: 'paste',
  delete: 'delete',
  selectAll: 'selectAll',
};
const TYPING = `(() => {
  const t = document.activeElement;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
})()`;

/** Shell items the page has no part in, appended to the page's menus of the same id. */
const EXTRAS = {
  file: [{ type: 'separator' }, { role: 'quit' }],
  view: [{ type: 'separator' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools' }],
};

/**
 * Build the application menu from the page's model ([{ id, label, items: [{ id, label, type, checked, enabled,
 * accelerator } | { type: 'separator' }] }]), sending clicks to `getWindow()`'s page.
 */
function buildMenu(model, getWindow) {
  const run = (id) => async () => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    const wc = win.webContents;
    if (TEXT_EDIT[id] && (await wc.executeJavaScript(TYPING).catch(() => false))) wc[TEXT_EDIT[id]]();
    else wc.send('pp:menu', id);
  };
  const menus = model.length
    ? model
    : [
        { id: 'file', label: 'File', items: [] },
        { id: 'view', label: 'View', items: [] },
      ];
  const template = menus.map((m) => {
    const items = m.items.map((it) =>
      it.type === 'separator'
        ? { type: 'separator' }
        : {
            id: it.id,
            label: it.label.replace(/&/g, '&&'),
            type: it.type === 'radio' || it.type === 'checkbox' ? it.type : 'normal',
            checked: !!it.checked,
            enabled: it.enabled !== false,
            accelerator: it.accelerator,
            registerAccelerator: false,
            click: run(it.id),
          },
    );
    const extra = EXTRAS[m.id] || [];
    return { label: '&' + m.label, submenu: items.length ? [...items, ...extra] : extra.slice(1) };
  });
  if (process.platform === 'darwin') template.unshift({ role: 'appMenu' });
  return Menu.buildFromTemplate(template);
}

/** Validate the page's menu model: plain objects with string labels only. */
function sanitize(model) {
  if (!Array.isArray(model)) return [];
  const str = (v) => (typeof v === 'string' ? v.slice(0, 200) : '');
  return model.slice(0, 12).map((m) => ({
    id: str(m && m.id),
    label: str(m && m.label),
    items: (Array.isArray(m && m.items) ? m.items : []).slice(0, 80).map((it) =>
      it && it.type === 'separator'
        ? { type: 'separator' }
        : {
            id: str(it && it.id),
            label: str(it && it.label),
            type: str(it && it.type),
            checked: !!(it && it.checked),
            enabled: !(it && it.enabled === false),
            accelerator: str(it && it.accelerator) || undefined,
          },
    ),
  }));
}

module.exports = { buildMenu, sanitize };
