'use strict';

// electron-builder's afterAllArtifactBuild hook: after a Linux build, wraps the unpacked app (dist/linux-unpacked)
// and the icons into the self-extracting installer dist/davinci-<version>-linux-x64-setup.sh (install.sh with the
// app appended as a .tar.gz). Returns its path so it is listed with the other artifacts.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

module.exports = async function makeInstaller({ outDir, configuration, platformToTargets }) {
  const unpacked = path.join(outDir, 'linux-unpacked');
  const linux = [...platformToTargets.keys()].some((p) => p.name === 'linux');
  if (!linux || !fs.existsSync(unpacked)) return [];
  const version = configuration.extraMetadata?.version || require(path.join(ROOT, 'desktop', 'package.json')).version;
  const out = path.join(outDir, `davinci-${version}-linux-x64-setup.sh`);

  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'davinci-installer-'));
  try {
    execFileSync('cp', ['-a', unpacked, path.join(stage, 'app')]);
    fs.mkdirSync(path.join(stage, 'icons'));
    for (const f of fs.readdirSync(path.join(ROOT, 'installer', 'icons'))) {
      if (f.endsWith('.png')) fs.copyFileSync(path.join(ROOT, 'installer', 'icons', f), path.join(stage, 'icons', f));
    }
    fs.copyFileSync(path.join(ROOT, 'src', 'assets', 'davinci.svg'), path.join(stage, 'icons', 'davinci.svg'));
    const payload = execFileSync('tar', ['-cz', '--owner=0', '--group=0', '-C', stage, 'app', 'icons'], {
      maxBuffer: 1 << 30,
    });
    const header = fs.readFileSync(path.join(__dirname, 'install.sh'), 'utf8').replaceAll('@VERSION@', version);
    fs.writeFileSync(out, Buffer.concat([Buffer.from(header), payload]), { mode: 0o755 });
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
  console.log(`  • Linux installer  file=${path.relative(process.cwd(), out)}`);
  return [out];
};
