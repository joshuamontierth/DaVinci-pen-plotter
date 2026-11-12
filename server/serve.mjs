#!/usr/bin/env node
/**
 * DaVinci web server: serves the static app to browsers, read-only (GET and HEAD, no write endpoints).
 * Plain Node with no dependencies, on Windows, macOS and Linux. The desktop app's server mode
 * (`davinci --serve`) runs the same code on its bundled copy of the app.
 *
 *   node server/serve.mjs                    # http://127.0.0.1:8791 from src/, opens the browser
 *   node server/serve.mjs --port 9000        # custom port (or a bare 9000)
 *   node server/serve.mjs --host 0.0.0.0     # serve to the network too; prints the LAN addresses
 *   node server/serve.mjs --live             # reload the page when files change (CSS is swapped in place)
 *   node server/serve.mjs --no-open          # do not open a browser window
 *   node server/serve.mjs --root <dir>       # serve another copy of the app
 *
 * Responses carry Cache-Control: no-cache, so browsers revalidate and always run the latest files. Serving the
 * checkout also mounts the browser test page (test/browser/) at /tests/.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync, watch } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PORT = 8791;

const CHECKOUT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.stl': 'model/stl',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.gcode': 'text/plain; charset=utf-8',
};

const LIVE_CLIENT = `<script>(function () {
  var es = new EventSource('/__live');
  es.onmessage = function (e) {
    if (e.data === 'css') {
      document.querySelectorAll('link[rel="stylesheet"]').forEach(function (l) {
        var u = new URL(l.href); u.searchParams.set('v', Date.now()); l.href = u.href;
      });
    } else location.reload();
  };
})();</script>`;

function parseArgs(argv) {
  const opts = { port: DEFAULT_PORT, host: '127.0.0.1', open: true, live: false, root: null };
  const value = (i, name) => {
    if (i >= argv.length) throw new Error(`${name} needs a value`);
    return argv[i];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [flag, inline] =
      a.startsWith('--') && a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, null];
    if (flag === '--no-open') opts.open = false;
    else if (flag === '--live') opts.live = true;
    else if (flag === '--port') opts.port = Number(inline ?? value(++i, '--port'));
    else if (flag === '--host') opts.host = inline ?? value(++i, '--host');
    else if (flag === '--root') opts.root = resolve(inline ?? value(++i, '--root'));
    else if (/^\d+$/.test(a)) opts.port = Number(a);
    else throw new Error('Unknown argument: ' + a);
  }
  if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) throw new Error('Bad port: ' + opts.port);
  return opts;
}

/** Map a URL path onto a file under `dir`, or null if it leaves `dir` or names a hidden file. */
function fileIn(dir, urlPath) {
  const file = normalize(join(dir, urlPath));
  const rel = relative(dir, file);
  if (isAbsolute(rel) || rel.split(sep).some((part) => part === '..' || part.startsWith('.'))) return null;
  return file;
}

/** The file for a request path: the longest matching mount wins, then the root. */
function resolvePath(root, mounts, urlPath) {
  let p;
  try {
    p = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  if (p.includes('\0')) return null;
  const prefix = Object.keys(mounts)
    .sort((a, b) => b.length - a.length)
    .find((m) => p === m.slice(0, -1) || p.startsWith(m));
  if (prefix) return fileIn(mounts[prefix], p.slice(prefix.length - 1));
  return fileIn(root, p);
}

/** http://address:port/ for every IPv4 address other computers can reach, for a server on all interfaces. */
export function lanUrls(port) {
  const urls = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))
        urls.push(`http://${a.address}:${port}/`);
    }
  }
  return urls;
}

/**
 * Serve `root` (and `mounts`: { '/prefix/': dir }) on host:port. Resolves with the http.Server once it listens.
 * live: inject a reload client into HTML pages and push file changes under `root` to it.
 */
export function startServer({ root, mounts = {}, port = DEFAULT_PORT, host = '127.0.0.1', live = false }) {
  const clients = new Set();

  const server = createServer((req, res) => {
    const url = req.url || '/';
    const plain = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...plain, Allow: 'GET, HEAD' }).end('Method not allowed');
      return;
    }
    if (live && url === '/__live') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    let file = resolvePath(root, mounts, url);
    if (!file) {
      res.writeHead(403, plain).end('Forbidden');
      return;
    }
    let st;
    try {
      st = statSync(file);
      if (st.isDirectory()) {
        const path = url.split('?')[0];
        if (!path.endsWith('/')) {
          res.writeHead(301, { Location: path + '/' }).end();
          return;
        }
        file = join(file, 'index.html');
        st = statSync(file);
      }
      if (!st.isFile()) throw new Error('not a file');
    } catch {
      res.writeHead(404, plain).end('Not found');
      return;
    }
    const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
    const modified = new Date(Math.floor(st.mtimeMs / 1000) * 1000);
    const headers = {
      'Content-Type': type,
      'Cache-Control': 'no-cache',
      'Last-Modified': modified.toUTCString(),
      'X-Content-Type-Options': 'nosniff',
    };
    const since = Date.parse(req.headers['if-modified-since'] || '');
    if (since >= modified.getTime()) {
      res.writeHead(304, headers).end();
      return;
    }
    if (live && type.startsWith('text/html')) {
      const html = readFileSync(file, 'utf8');
      const out = html.includes('</body>') ? html.replace('</body>', LIVE_CLIENT + '</body>') : html + LIVE_CLIENT;
      res.writeHead(200, { ...headers, 'Cache-Control': 'no-store' }).end(req.method === 'HEAD' ? undefined : out);
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  });

  if (live) {
    let timer = null;
    let cssOnly = true;
    const watcher = watch(root, { recursive: true }, (_event, name) => {
      if (!name) return;
      if (extname(name) !== '.css') cssOnly = false;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const msg = cssOnly ? 'css' : 'reload';
        cssOnly = true;
        for (const c of clients) c.write('data: ' + msg + '\n\n');
      }, 120);
    });
    server.on('close', () => watcher.close());
  }

  return new Promise((resolveStart, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolveStart(server));
  });
}

/** The lines to print once the server listens: where to open it, from this computer and from the network. */
export function describe({ host, port }) {
  const local = `http://${host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host}:${port}/`;
  const lines = [`  This computer:  ${local}`];
  if (host === '0.0.0.0' || host === '::') {
    const lan = lanUrls(port);
    lan.forEach((u, i) => lines.push(`  ${i ? '                ' : 'Your network:   '}${u}`));
    if (!lan.length) lines.push('  Your network:   (no network connection found)');
  }
  return { url: local, lines };
}

function openBrowser(url) {
  const win = process.platform === 'win32';
  const cmd = win
    ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]];
  try {
    // windowsVerbatimArguments keeps `start "" <url>` intact (the empty title must stay a literal "")
    const child = spawn(cmd[0], cmd[1], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments: win,
    });
    child.on('error', () => {});
    child.unref();
  } catch {
    /* no browser available: the URL is printed anyway */
  }
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  const root = opts.root || join(CHECKOUT, 'src');
  const tests = join(CHECKOUT, 'test', 'browser');
  const mounts = !opts.root && existsSync(tests) ? { '/tests/': tests } : {};
  if (!existsSync(join(root, 'index.html'))) {
    console.error(`No app to serve: ${join(root, 'index.html')} is missing.`);
    process.exit(2);
  }
  try {
    await startServer({ ...opts, root, mounts });
  } catch (e) {
    if (e.code === 'EADDRINUSE') console.error(`Port ${opts.port} is already in use. Try --port ${opts.port + 1}.`);
    else console.error(e.message);
    process.exit(1);
  }
  const { url, lines } = describe(opts);
  console.log(`DaVinci is running${opts.live ? ' with live reload' : ''} (Ctrl+C to stop)`);
  console.log(lines.join('\n'));
  if (mounts['/tests/']) console.log(`  Tests:          ${url}tests/`);
  if (opts.open) setTimeout(() => openBrowser(url), 300);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
