// Stage the static web app (src/) into desktop/bundle/app/ so Electron (dev) and electron-builder (dist) both load
// the same files. Runs before `desktop:start` / `desktop:dist`. Plain Node so it behaves the same on Windows and Linux.
// desktop/bundle/ is a build artifact: it is git-ignored, wiped and re-copied on every run.
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const src = path.join(root, 'src');
const bundle = path.join(here, 'bundle');
const out = path.join(bundle, 'app');

// Everything the page loads at runtime, from src/. README.md (the credits and licence notes; vendor/ has its own
// licence files) comes from the repository root. If index.html starts referencing another file or folder in src/,
// add it here; the check at the bottom fails the build if something it references did not make it into the bundle.
const ENTRIES = ['index.html', 'css', 'js', 'vendor', 'assets'];
const SOURCES = [...ENTRIES.map((name) => path.join(src, name)), path.join(root, 'README.md')];

const JUNK = new Set(['.DS_Store', 'Thumbs.db', 'Desktop.ini']);

await rm(bundle, { recursive: true, force: true });
await mkdir(out, { recursive: true });

// The window and tray icons (installer/icons/, rendered from src/assets/davinci.svg by `npm run icons`), and the web
// server for `davinci --serve`
await cp(path.join(root, 'installer', 'icons'), path.join(bundle, 'icons'), { recursive: true });
await cp(path.join(root, 'server', 'serve.mjs'), path.join(bundle, 'server', 'serve.mjs'));

for (const from of SOURCES) {
  try {
    await stat(from);
  } catch {
    throw new Error(`desktop/prepare: ${from} not found`);
  }
  await cp(from, path.join(out, path.basename(from)), {
    recursive: true,
    filter: (file) => !JUNK.has(path.basename(file)),
  });
}

// Stamp the build with its commit and date (shown at the end of Help → Safety), so builds can be told apart.
const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};
const changed = git('status', '--porcelain', '--', ...SOURCES) ? ' + local changes' : '';
const stamp = `${git('rev-parse', '--short', 'HEAD') || 'unknown commit'}${changed}, ${new Date().toISOString().slice(0, 10)}`;
const html = (await readFile(path.join(out, 'index.html'), 'utf8')).replace(
  /<head>/i,
  `<head>\n  <meta name="pp-build" content="${stamp}">`,
);
await writeFile(path.join(out, 'index.html'), html);

// Every local src/href in index.html must exist in the bundle.
const missing = [];
for (const m of html.matchAll(/\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
  const ref = (m[1] ?? m[2]).split(/[?#]/)[0];
  if (!ref || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref)) continue; // data:, https:, //cdn...
  try {
    await stat(path.join(out, ref));
  } catch {
    missing.push(ref);
  }
}
if (missing.length) {
  throw new Error(`desktop/prepare: index.html references files that are not bundled: ${missing.join(', ')}`);
}

console.log(`desktop/prepare: staged the app into ${path.relative(process.cwd(), out) || '.'}`);
