# DaVinci

A pen-plotter G-code generator for **Bambu Lab** printers: the X1 Carbon, X1/X1E, P1S/P1P and A1, plus a generic
Marlin profile. A pen holder clips onto the toolhead, and DaVinci turns text, drawings, images and patterns
into plain G-code that you print from the SD card. There are no firmware changes. It's modelled on
[3dplotter.xyz](https://3dplotter.xyz) and set up for Falu's pen mount
([MakerWorld 2029113](https://makerworld.com/en/models/2029113-modular-system-for-a1-p1-x1-series)). Workflow:
[Instructables guide](https://www.instructables.com/Turn-Your-Bambu-Lab-X1-Carbon-Into-a-Pen-Plotter-i/).

You design on a to-scale model of the plate and preview the **simulated G-code**. Every file passes a safety check
before you can download it.

> **Work in progress.** DaVinci is under active development and has been tried on one X1 Carbon (dry runs and the
> pause behaviour), not on every printer it lists. Watch the printer while it plots, keep a hand near Pause, and
> read [docs/HANDOFF.md](docs/HANDOFF.md) before your first plot.
>
> **Alpha:** the **pen-holder resizer** (Download pen mount) and **cutting** are early experiments. Their output has
> not been proven on a printer yet; see [Alpha features](#alpha-features).

## Install

Download the installer for your computer from [Releases](https://github.com/joshuamontierth/DaVinci-pen-plotter/releases/latest).

- **Windows:** run `davinci-<version>-win-x64-setup.exe`. Choose just you or everyone, then the folder. The next page
  offers **Web server mode** (below). The installer is unsigned, so SmartScreen warns about it, and Windows 11 Smart
  App Control may block it.
- **Linux (x64):** run `sh davinci-<version>-linux-x64-setup.sh`. It installs for your user (no root needed) and asks
  what you want: the desktop app, the web server, or both. `--app`, `--server` or `--both` (with `--port N`) skip
  the question, and `sh ~/.local/share/davinci/uninstall.sh` removes everything it installed. There's also a
  `.deb` (`sudo apt install ./davinci_<version>_amd64.deb`) and an AppImage that runs without installing.

DaVinci opens `.davinci` project files from the file manager. Projects and settings stay on your computer.

### Web server mode

The web server serves DaVinci to browsers on your network, so a laptop, tablet or phone can use it without
installing anything. It only serves the app: designs, settings and saved files stay in each browser.

- **Windows:** tick **Web server mode** in the installer and pick a port (8791 by default). DaVinci then runs in the
  background whenever you sign in, with a tray icon to open or stop it, and Windows Firewall lets in other computers
  on private networks only. The last page shows the address. Running the installer again changes the choice;
  uninstalling removes the background task and the firewall rule.
- **Linux:** choose the web server (or both) in `setup.sh`. It adds `davinci-server.service`, a systemd user service
  that starts when you log in, and prints the addresses. `loginctl enable-linger $USER` keeps it running while you
  are logged out; with ufw on, `sudo ufw allow 8791/tcp`. With the .deb, turn it on with
  `systemctl --user enable --now davinci-server`.
- **By hand:** `davinci --serve [--port N] [--host 0.0.0.0]`. It listens on 127.0.0.1 unless `--host 0.0.0.0` is
  given, and prints the network addresses.

Over plain `http://` from another computer, browsers keep a few things for secure pages: Save writes a download
instead of updating the same file, and **Installed fonts** isn't available.

## Features

| Area | What you get |
|---|---|
| **Text** | 40 single-stroke Hershey and EMS fonts, your installed system fonts and uploaded TTF/OTF (outlines, optional hatch fill), **My Handwriting** (draw your own glyphs), multi-line, alignment, spacing, text on an arc |
| **Draw** | Freehand, line, polyline, smooth curve, rectangle, ellipse, polygon, star and eraser in the tool strip. The active tool's settings sit in a small bar on the canvas |
| **Image** | Trace a picture as Outline, Center line, Edges, Contours, Photo hatch, Squiggle, Spiral or Stipple, with a live preview |
| **Patterns** | 23 generators (spirograph, harmonograph, mandala, guilloche, Hilbert, maze, flow field, topo...) |
| **Import / export** | SVG import (curves, arcs, transforms; each stroke color on its own layer), SVG export, and `.davinci` project files (gzipped JSON). Save writes back to the same file where the browser allows it |
| **Editing** | Move, scale and rotate handles, mirror, align, fit to paper, hatch fill, convert to path, combine, lock, undo/redo, autosave |
| **Layers = pens** | One file with a pause for each pen change, or one file per layer. Per-layer pen height and speed, kept in a safe window |
| **Preview** | Animates the simulated G-code: strokes, travel, the nozzle and toolhead position, and a safety badge |
| **Safety check** | Every file is replayed on a virtual printer before you can download it (see below) |
| **Calibration** | Frame test, **Offset finder**, Z test and Z × speed grid, with a guide in Help |
| **Printers** | Bambu Lab X1 Carbon, X1/X1E and P1S/P1P (Falu mount), A1 (3dplotter.xyz holder), and a generic Marlin profile, each with its own safe zone and pauses |
| **Pauses** | Attach the pen at the first pause; on the X1/P1 the nozzle is warmed to 90 °C first, so Resume takes about 4 s instead of over a minute |
| **Pen mount** *(alpha)* | Resizes the pen tube of the mount's cartridge and spring for your pen's measured diameter (see below) |
| **Desktop app** | Windows and Linux (Electron): works offline, uses your system fonts, native menus and save dialogs, opens `.davinci` files from the file manager |
| **Web server** | Serve the app to browsers on your network, set up by the installer (see [Web server mode](#web-server-mode)) |
| **Look** | A menu bar (File, Edit, View, Printer, Help) with the usual shortcuts, and light and dark themes that follow your system |

## Alpha features

These work in the software and are tested there, but the results haven't been checked on a printer. Expect changes.

### Pen holder resizer (Download pen mount)

File → **Download pen mount** (also in Printer settings → Pen mount) takes the mount's pen cartridge and spring and changes only
their pen tube. Enter your pen's measured diameter, and the tool cuts a new bore while keeping at least 1.2 mm of
wall. It shows the largest pen the parts support and saves the two resized parts, plus the attachment for your
printer (X1/P1 or A1), ready to print. The resized parts have not been printed and fitted yet.

The parts are Falu's design, and their MakerWorld license doesn't allow shipping them with this app. Add them once:

1. Open the dialog and click **MakerWorld**, or go to
   [the model page](https://makerworld.com/en/models/2029113-modular-system-for-a1-p1-x1-series).
2. Download the STL files: the pen cartridge, the spring and the attachment for your printer.
3. Click **Add files…** and pick them, or the ZIP as it downloaded. Each file is matched to its part by name. Any
   part that isn't recognized has its own **Choose…** button.

The app keeps the parts in its own storage, so you only do this once per browser or desktop install.

### Cutting (branch `cutting`)

A layer can be the **cut layer**: a drag knife (Roland-type blades) cuts it after every pen layer, following a pause
to swap holders. The G-code corrects for the blade trailing behind the holder: it swivels at corners, cuts past the
start so shapes close (overcut), and cuts holes before the shapes around them. Calibrate has a cut-depth test and a
blade-offset test, and the export warns about open paths, one-stroke fonts and tiny pieces. **No knife mount exists
yet, and nothing has been cut.** See [docs/cutting.md](https://github.com/joshuamontierth/DaVinci-pen-plotter/blob/cutting/docs/cutting.md) on that branch.

### Save to SD card (branch `removable-drive`)

In the desktop app, the export can save straight to an SD card or USB drive and eject it, like Cura. Not yet tried
with a real card.

## Running from source

`npm start` serves `src/` at http://127.0.0.1:8791 and opens it (Node 24, no dependencies needed for this):
`node server/serve.mjs` does the same, with `--host 0.0.0.0` for the network. Opening `src/index.html` directly
also works, but then fonts load from a CDN and the pen-mount tool is unavailable. Fonts and libraries are bundled in
`src/vendor/`, so with a server or the desktop app nothing needs the internet. Work autosaves in the app; **File →
Save** writes a `.davinci` file.

## X1C defaults

| Setting | Value | Source / meaning |
|---|---|---|
| Pen offset | **X −28, Y −35 mm** | The pen is 28 mm **left** of and 35 mm **in front** of the nozzle, inferred from the designer's notes. Confirm yours with the Offset finder |
| Nozzle safe zone | **X 48–256, Y 55–256** | Designer's excluded area `(0,0 258,0 258,55 48,55 48,258 0,258)`: outside it the module can hit the walls or the door |
| Drawable area | ≈ 206 × 199 mm | Pen X 21–227, Y 21–220: the safe zone shifted by the offset, with a 1 mm margin |
| Z-Draw / Z-Lift | 14 / 20 mm | From Instructables. The designer uses Z ≈ 17 for a Stabilo; it depends on how far the pen sticks out |
| Attach / end height | 60 / 80 mm | The bed drops this far for attaching and removing the holder |
| Park (pauses) | nozzle X80 Y245 | Next to the purge chute, where the firmware moves the toolhead during every pause (it returns on Resume) |
| Speeds | draw 30, travel 200, Z 15 mm/s, accel 4000 | |
| Pen-down dwell | 50 ms via `M400 P50` | `G4` is reportedly unreliable on the X1 |

## What a file does (Bambu profile)

```
G90 / G21 / M83, heaters off, fans off, M220 S100, M204 S4000
G91 / M17 Z0.4 / G380 S2 Z30 / G380 S2 Z-25 / G1 Z5 / G90 / M17 ...   ; Bambu's own "drop the bed before homing"
G28                         ; home - holder NOT attached
G1 Z60 / G1 X80 Y245        ; bed down, park near the purge chute
M109 S90                    ; X1/P1: warm the nozzle first, so Resume does not wait ~70 s for it to cool
M400 U1                     ; PAUSE 1: attach the pen holder, press Resume
M104 S0                     ; heater off again before anything moves
G1 Z20                      ; pen up (travel height)
  G1 X.. Y.. F12000         ; travel (nozzle coords = pen - offset)
  G1 Z14 F900               ; pen down (pure Z move)
  M400 P50                  ; dwell
  G1 X.. Y.. F1800 ...      ; draw
  G1 Z20 F900               ; pen up
  (pen change between layers: bed to Z60, park, M109 S90 / M400 U1 / M104 S0)
G1 Z80                      ; bed down at the end (no end pause by default: remove the holder after it finishes)
G1 X152 Y250                ; toolhead to the back
```

## The safety check (`src/js/core/gcodesim.js`)

It replays the file on a virtual printer and refuses it, or warns, when:

- the nozzle leaves the safe zone, or the pen or holder would leave the plate, while the holder is attached;
- an XY move happens with the nozzle on the plate, or XY and Z change together while the pen is low;
- Z changes while the pen is down, or the pen goes down to a height that isn't configured or is below the safe floor;
- the printer homes or probes with the holder attached;
- a pause has no bed clearance or happens with the pen down, or the file ends with the pen down;
- a heater is switched on (except the pause warm-up, which must be off before anything moves), the file extrudes,
  or it uses G92 / G20;
- the motors are disabled mid-plot, a value is NaN or undefined, or a move has no feed rate;
- the number of strokes or the drawn length doesn't match the design, which catches a missing pen lift.

It also rebuilds every stroke and travel move for the preview.

## Development

The app has no build step: `src/js/` is plain browser scripts loaded in order by `src/index.html`. The tooling runs
on **Node 24 LTS** on Windows and Linux.

| Setup | Linux (Ubuntu) | Windows |
|---|---|---|
| Node 24 | NodeSource: `curl -fsSL https://deb.nodesource.com/setup_24.x \| sudo -E bash -` then `sudo apt install nodejs` | `winget install OpenJS.NodeJS.LTS` |
| Dependencies | `npm ci` | `npm ci` |
| Test browser (once) | `npx playwright install chromium` | `npx playwright install chromium` |

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with live reload |
| `npm start` | Server without live reload (`-- --port 9000`, `-- --no-open`, `-- --host 0.0.0.0`) |
| `npm test` | Vitest: unit tests, the shared suites and a 30-scenario seeded fuzz, in Node |
| `npm run test:fuzz` | 2000 fuzz scenarios (`FUZZ_N` / `FUZZ_SEED` override the counts) |
| `npm run test:e2e` | Playwright: UI tests and the full browser suite in Chromium, offline |
| `npm run lint` / `format` / `typecheck` | ESLint, Prettier, `tsc --checkJs` on the core modules |
| `npm run check` | Everything CI runs |
| `npm run vendor` | Re-download the pinned fonts and libraries into `src/vendor/` |
| `npm run icons` | Render the icon (`src/assets/davinci.svg`) into the installers' PNG sizes and `.ico` |

- **Shared suites:** `test/browser/harness.js` holds the suites, used by both the browser page (`test/browser/`,
  served at `/tests/`) and Vitest. A failing fuzz seed replays in the browser at `/tests/` with
  `await replayScenario(<seed>)`.
- **Golden file:** `test/unit/__snapshots__/x1c-square.gcode`. If a deliberate change alters the G-code, review the
  diff and run `npx vitest -u`.
- **CI:** runs everything on Ubuntu and Windows, plus a nightly deep fuzz.

### Desktop app and installers

`desktop/` wraps the app in Electron and serves it from `app://davinci/`; `installer/` holds the packaging. Run
`npm run desktop:install` once, then `npm run desktop:start` (a dev window) or `npm run desktop:dist`.
- **Output** in `dist/`, for the OS you're on: `davinci-<version>-win-x64-setup.exe` on Windows;
  `davinci-<version>-linux-x64-setup.sh`, the AppImage and the `.deb` on Linux.
- **Checks:** `npm run desktop:test -- --packaged` smoke-tests the built app (menus, saving, fonts, storage, G-code,
  `--serve`). `installer/windows/test-installer.ps1` installs and uninstalls the Windows installer with the web
  server; CI runs both, plus the Linux installer.
- **Signing:** builds are unsigned.
- **Ubuntu 24.04+:** the AppImage and the `davinci` command from `setup.sh` fall back to `--no-sandbox` when Chromium's
  sandbox is unavailable.

## Files

```
src/          the web app: index.html, css/, js/ (core/, app/, ui/), vendor/, assets/ (icon), types/
server/       serve.mjs: the web server (npm start, the desktop app's --serve, the tests)
desktop/      Electron shell: main.js, menu.js (native menu), server.js (--serve), preload.js, prepare.mjs
installer/    packaging: electron-builder.config.cjs, windows/ (NSIS web server page), linux/ (setup.sh, .deb unit),
              icons/ (rendered from src/assets/davinci.svg)
test/         unit/ (Vitest + the golden G-code file), e2e/ (Playwright), browser/ (the in-browser suite)
scripts/      vendor.mjs, icons.mjs, desktop-smoke.mjs
docs/         HANDOFF.md (status, hardware facts, open questions) and the pause-temperature test file
dist/         build output (git-ignored)
```

## Credits

- The Hershey Fonts were originally created by Dr. A. V. Hershey while working at the U. S. National Bureau of
  Standards. The format of the font data was originally created by James Hurt, Cognition, Inc. The SVG font versions
  are by Windell H. Oskay (Evil Mad Scientist), via [hersheytext](https://github.com/techninja/hersheytext) (MIT).
- [opentype.js](https://opentype.js.org/) (MIT) and [manifold-3d](https://github.com/elalish/manifold) (Apache-2.0).
- The pen mount and its safe-zone data are by Falu Mendy Vergara
  ([MakerWorld](https://makerworld.com/en/models/2029113-modular-system-for-a1-p1-x1-series)). The mount files are not
  included: download them from MakerWorld.

This project is not affiliated with Bambu Lab, 3dplotter.xyz or the mount designer. Watch the printer while it plots.
