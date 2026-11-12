'use strict';

// Web server mode: `davinci --serve [--port N] [--host 0.0.0.0]`. No window: the bundled app is served to browsers
// (read-only, server/serve.mjs), on 127.0.0.1 unless --host says otherwise. On Windows a tray icon opens it in the
// browser, copies the network addresses and stops the server. On Linux, where it usually runs as a systemd service
// with no display (Chromium cannot start without one), the server runs in Electron's plain Node mode instead.

const { app, clipboard, Menu, nativeImage, shell, Tray } = require('electron');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SERVE_MJS = path.join(__dirname, 'bundle', 'server', 'serve.mjs');

/** The value after `--name` (or in `--name=value`), else null. */
function option(argv, name) {
  const i = argv.indexOf(name);
  if (i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith('--')) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(name + '='));
  return eq ? eq.slice(name.length + 1) : null;
}

let tray = null; // kept referenced: a collected Tray disappears

/** Linux: serve.mjs under Electron's Node, before Chromium starts. Never returns. */
function runAsNode(argv, appDir) {
  const args = [SERVE_MJS, '--root', appDir, '--no-open'];
  for (const name of ['--host', '--port']) {
    const v = option(argv, name);
    if (v !== null) args.push(name, v);
  }
  const r = spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  process.exit(r.status === null ? 1 : r.status);
}

async function runServer({ argv, appDir, iconDir }) {
  if (process.platform === 'linux') runAsNode(argv, appDir);
  // its own profile, so the server and the desktop app can run side by side
  app.setPath('userData', path.join(app.getPath('userData'), 'server'));
  if (!app.requestSingleInstanceLock()) {
    console.error('DaVinci: the web server is already running.');
    app.exit(1);
    return;
  }
  const server = await import(pathToFileURL(SERVE_MJS).href);
  const host = option(argv, '--host') || '127.0.0.1';
  const port = Number(option(argv, '--port') || server.DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('DaVinci: bad port ' + option(argv, '--port'));
    app.exit(2);
    return;
  }
  let http;
  try {
    http = await server.startServer({ root: appDir, host, port });
  } catch (e) {
    console.error(e.code === 'EADDRINUSE' ? `DaVinci: port ${port} is already in use.` : 'DaVinci: ' + e.message);
    app.exit(1);
    return;
  }
  const { url, lines } = server.describe({ host, port });
  console.log('DaVinci web server (Ctrl+C to stop)\n' + lines.join('\n'));

  const stop = () => {
    http.close();
    app.quit();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  await app.whenReady();
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  try {
    const icon = nativeImage.createFromPath(
      path.join(iconDir, process.platform === 'win32' ? 'davinci.ico' : '32x32.png'),
    );
    tray = new Tray(icon);
  } catch {
    return; // no tray on this desktop (or no desktop): the server runs on
  }
  const lan = host === '0.0.0.0' || host === '::' ? server.lanUrls(port) : [];
  tray.setToolTip(`DaVinci web server\n${lan[0] || url}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'DaVinci web server', enabled: false },
      { type: 'separator' },
      { label: 'Open in browser', click: () => shell.openExternal(url) },
      ...lan.map((u) => ({ label: `Copy ${u}`, click: () => clipboard.writeText(u) })),
      { type: 'separator' },
      { label: 'Stop server', click: stop },
    ]),
  );
  tray.on('click', () => shell.openExternal(url));
}

module.exports = { runServer };
