# DaVinci - notes for agents

A static, no-build web app that turns designs into pen-plotter G-code for Bambu Lab printers. `src/js/` is plain
browser scripts that attach to `window.PP`, loaded in order by `src/index.html`. `server/serve.mjs` serves it
(also as the desktop app's `--serve` web server mode), `desktop/` wraps it in Electron, and `installer/` packages it.
**docs/HANDOFF.md is the engineering record. Read §0–3 before touching anything that changes the G-code.**

## Ground rules

- **Cross-platform.** The owner works on both Windows and Linux.
  - npm scripts must not use bash-isms: use Node scripts in `scripts/` and `cross-env` for environment variables.
  - Line endings are LF. `.gitattributes` enforces this, and only `.bat`/`.cmd` files are CRLF.
- **Printer safety.** Treat `src/js/core/gcode.js` (profiles, `build()`) and `src/js/core/gcodesim.js` (the safety
  simulator) as safety-critical.
  - A change to the generated G-code shows as a diff in `test/unit/__snapshots__/x1c-square.gcode`. Review it, then
    run `npx vitest -u`.
  - Record any hardware facts in HANDOFF §3.2.
- **Git.**
  - Commit only the files you changed (`git add <paths>`, never `-A`).
  - Never push or tag without the owner's OK.
  - End commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Agent preferences.** Be conservative with tokens: prefer targeted greps and reads over whole files, few
  screenshots, and run the full suites once per batch of changes. Subagents run on Sonnet or Haiku only.

## Setup (Windows or Linux)

| Step | Windows (PowerShell) | Linux |
|---|---|---|
| Node 24 LTS | `winget install OpenJS.NodeJS.LTS` | NodeSource: see README → Development |
| Dependencies | `npm ci` | `npm ci` |
| Test browser | `npx playwright install chromium` | `npx playwright install chromium` |
| Desktop deps | `npm run desktop:install` | `npm run desktop:install` |

## Commands

- `npm run check`: lint, Prettier, type check, Vitest (Node) and Playwright (Chromium). This is what CI runs.
- `npm test` runs Vitest alone; `npm run test:e2e` runs Playwright alone; `npm run test:fuzz` is the 2000-scenario
  fuzz. A failing fuzz seed replays in the browser at `/tests/` with `await replayScenario(<seed>)`.
- `npm run dev` starts the dev server at http://127.0.0.1:8791 with live reload.
- `npm run desktop:dist` builds the desktop app and its installers for the current OS into `dist/` (config:
  `installer/electron-builder.config.cjs`). Building the Windows installer on Linux needs Wine.
- `npm run desktop:test -- --packaged` smoke-tests the built app: it loads, the native menu works, File → Save
  writes and writes back, fonts work offline, installed fonts are available, storage works, the welcome design's
  G-code passes the simulator, `--serve` serves read-only, and there are no console errors. On Linux without a
  display, prefix it with `xvfb-run -a`.
- `installer/windows/test-installer.ps1` installs the Windows installer silently with the web server, checks the Run
  key, firewall rule and server, then uninstalls and checks nothing is left. It really installs: CI only.

## Windows test checklist (for an agent on the Windows machine)

Run these in order from a fresh clone (`git clone git@github.com:joshuamontierth/DaVinci-pen-plotter.git`). Report
each step as pass or fail, with the last ~30 lines of output for any failure:

1. `node -v` and `npm -v`: expect Node v24.x.
2. `npm ci`, then `npx playwright install chromium`.
3. `npm run check`.
4. `npm run desktop:install`, then `npm run desktop:dist`. Expect `dist/davinci-*-win-x64-setup.exe` and
   `dist/win-unpacked/`.
   - If electron-builder fails while extracting `winCodeSign` with a symlink-privilege error, enable Windows
     Developer Mode (Settings → System → For developers) or use an elevated terminal, then retry.
5. `npm run desktop:test -- --packaged`: expect `18/18 checks passed (packaged app, win32)`.
6. `git status` must show no changes. If the build or tests modified tracked files, report which ones.

Windows SmartScreen warns about the unsigned .exe. That's expected until code signing is set up.
