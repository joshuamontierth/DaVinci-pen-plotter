'use strict';

// The bridge from the page to the desktop shell: saving with native dialogs (saveFiles in main.js), project files
// (open, save to the same file, opened from the file manager) and the native menu. The page still has no Node
// access; it can only hand over file names and contents, and the menus as plain data.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ppDesktop', {
  /** files: [{ name, data: string | ArrayBuffer | Uint8Array }] → { saved: [paths], dir } or { canceled: true } */
  saveFiles: (files, opts) => ipcRenderer.invoke('pp:save-files', files, opts || {}),
  /** the project file the app was opened with, once ({ name, data }), then any opened later */
  takeOpenFile: () => ipcRenderer.invoke('pp:take-open-file'),
  onOpenFile: (cb) => ipcRenderer.on('pp:open-file', (_e, f) => cb(f)),
  /** ask for a .davinci file: { name, data } or null; it becomes the project's file */
  openProject: () => ipcRenderer.invoke('pp:open-project'),
  /** write the project to its file (asking first with opts.saveAs, or if it has none) → { name, chosen } or { canceled } */
  saveProject: (data, opts) => ipcRenderer.invoke('pp:save-project', data, opts || {}),
  /** a new project (or one that failed to open) has no file */
  closeProject: () => ipcRenderer.invoke('pp:close-project'),
  /** the menus as data (src/js/ui/menubar.js); clicks come back through onMenu as command ids */
  setMenu: (model) => ipcRenderer.send('pp:set-menu', model),
  onMenu: (cb) => ipcRenderer.on('pp:menu', (_e, id) => cb(id)),
});
