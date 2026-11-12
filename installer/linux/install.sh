#!/bin/sh
# DaVinci @VERSION@ for Linux (x64): installs for the current user, no root needed.
#
#   sh davinci-@VERSION@-linux-x64-setup.sh                  asks: desktop app, web server, or both
#   sh davinci-@VERSION@-linux-x64-setup.sh --app            the desktop app
#   sh davinci-@VERSION@-linux-x64-setup.sh --server [--port N]   the web server (a systemd user service)
#   sh davinci-@VERSION@-linux-x64-setup.sh --both [--port N]
#   sh davinci-@VERSION@-linux-x64-setup.sh --uninstall      removes everything it installed
#
# The app goes to ~/.local/share/davinci/app and the `davinci` command to ~/.local/bin. The desktop app adds a
# menu entry, icons and the .davinci file type; the web server adds davinci-server.service, which serves DaVinci to
# browsers on the network (`davinci --serve --host 0.0.0.0 --port N`). ~/.local/share/davinci/uninstall.sh (this
# script without the app, or --uninstall) removes it all again. Your projects and settings (~/.config/DaVinci) stay.
set -eu

VERSION='@VERSION@'
DEFAULT_PORT=8791
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}"
HOME_DIR="$DATA/davinci"
APP_DIR="$HOME_DIR/app"
BIN="$HOME/.local/bin/davinci"
DESKTOP_FILE="$DATA/applications/davinci.desktop"
MIME_FILE="$DATA/mime/packages/davinci.xml"
UNIT_DIR="$CONFIG/systemd/user"
UNIT="davinci-server.service"
ICON_SIZES='16 24 32 48 64 128 256 512'

say() { printf '%s\n' "$*"; }
die() { printf 'DaVinci setup: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }
user_systemd() { have systemctl && systemctl --user show-environment >/dev/null 2>&1; }

usage() {
  sed -n '3,8p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

# ----------------------------------------------------------------------------------------------------------------
# Removing (also what uninstall.sh runs)
# ----------------------------------------------------------------------------------------------------------------
remove_server() {
  if [ -f "$UNIT_DIR/$UNIT" ]; then
    if user_systemd; then
      systemctl --user disable --now "$UNIT" >/dev/null 2>&1 || true
    fi
    rm -f "$UNIT_DIR/$UNIT"
    if user_systemd; then systemctl --user daemon-reload || true; fi
    say "Removed the web server ($UNIT)."
  fi
}

remove_desktop() {
  found=
  for f in "$DESKTOP_FILE" "$MIME_FILE" "$DATA/icons/hicolor/scalable/apps/davinci.svg" \
    "$DATA/icons/hicolor/scalable/mimetypes/application-x-davinci.svg"; do
    if [ -e "$f" ]; then rm -f "$f"; found=1; fi
  done
  for s in $ICON_SIZES; do
    for f in "$DATA/icons/hicolor/${s}x${s}/apps/davinci.png" "$DATA/icons/hicolor/${s}x${s}/mimetypes/application-x-davinci.png"; do
      if [ -e "$f" ]; then rm -f "$f"; found=1; fi
    done
  done
  for list in "$CONFIG/mimeapps.list" "$DATA/applications/mimeapps.list"; do
    if [ -f "$list" ] && grep -q '^application/x-davinci=' "$list"; then
      sed -i '/^application\/x-davinci=/d' "$list"
      found=1
    fi
  done
  if [ -n "$found" ]; then
    refresh_desktop
    say "Removed the desktop app's menu entry, icons and file type."
  fi
}

remove_all() {
  remove_server
  remove_desktop
  if [ -f "$BIN" ] && grep -q 'DaVinci launcher' "$BIN"; then rm -f "$BIN"; fi
  if [ -d "$HOME_DIR" ]; then
    rm -rf "$HOME_DIR"
    say "Removed $HOME_DIR."
  fi
}

refresh_desktop() {
  if have update-mime-database && [ -d "$DATA/mime" ]; then update-mime-database "$DATA/mime" >/dev/null 2>&1 || true; fi
  if have update-desktop-database && [ -d "$DATA/applications" ]; then
    update-desktop-database "$DATA/applications" >/dev/null 2>&1 || true
  fi
  if have gtk-update-icon-cache && [ -f "$DATA/icons/hicolor/index.theme" ]; then
    gtk-update-icon-cache -q -t "$DATA/icons/hicolor" >/dev/null 2>&1 || true
  fi
}

# ----------------------------------------------------------------------------------------------------------------
# Installing
# ----------------------------------------------------------------------------------------------------------------
install_app() {
  payload="$1"
  rm -rf "$APP_DIR.new"
  mkdir -p "$HOME_DIR"
  mv "$payload/app" "$APP_DIR.new"
  rm -rf "$APP_DIR"
  mv "$APP_DIR.new" "$APP_DIR"
  mkdir -p "$HOME_DIR/icons"
  cp "$payload/icons/"* "$HOME_DIR/icons/"

  mkdir -p "$(dirname "$BIN")"
  cat >"$BIN" <<LAUNCHER
#!/bin/sh
# DaVinci launcher, written by the DaVinci installer: \`davinci [project.davinci]\` opens the desktop app,
# \`davinci --serve [--port N] [--host 0.0.0.0]\` runs the web server.
APP='$APP_DIR'
for a; do
  if [ "\$a" = --serve ]; then
    # the web server runs Electron as plain Node: no display, no Chromium
    n=\$#
    while [ "\$n" -gt 0 ]; do
      a=\$1
      shift
      n=\$((n - 1))
      [ "\$a" = --serve ] || set -- "\$@" "\$a"
    done
    ELECTRON_RUN_AS_NODE=1 exec "\$APP/davinci" "\$APP/resources/app.asar/bundle/server/serve.mjs" \\
      --root "\$APP/resources/app.asar/bundle/app" --no-open "\$@"
  fi
done
# Chromium's sandbox needs unprivileged user namespaces (or a setuid helper); without them, run unsandboxed
if ! unshare -Ur true >/dev/null 2>&1; then set -- --no-sandbox "\$@"; fi
exec "\$APP/davinci" "\$@"
LAUNCHER
  chmod 755 "$BIN"

}

install_desktop() {
  mkdir -p "$DATA/applications" "$DATA/mime/packages" "$DATA/icons/hicolor/scalable/apps" \
    "$DATA/icons/hicolor/scalable/mimetypes"
  for s in $ICON_SIZES; do
    mkdir -p "$DATA/icons/hicolor/${s}x${s}/apps" "$DATA/icons/hicolor/${s}x${s}/mimetypes"
    cp "$HOME_DIR/icons/${s}x${s}.png" "$DATA/icons/hicolor/${s}x${s}/apps/davinci.png"
    cp "$HOME_DIR/icons/${s}x${s}.png" "$DATA/icons/hicolor/${s}x${s}/mimetypes/application-x-davinci.png"
  done
  cp "$HOME_DIR/icons/davinci.svg" "$DATA/icons/hicolor/scalable/apps/davinci.svg"
  cp "$HOME_DIR/icons/davinci.svg" "$DATA/icons/hicolor/scalable/mimetypes/application-x-davinci.svg"

  cat >"$MIME_FILE" <<'MIME'
<?xml version="1.0" encoding="UTF-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
  <mime-type type="application/x-davinci">
    <comment>DaVinci project</comment>
    <sub-class-of type="application/gzip"/>
    <icon name="application-x-davinci"/>
    <glob pattern="*.davinci"/>
  </mime-type>
</mime-info>
MIME

  cat >"$DESKTOP_FILE" <<DESKTOP
[Desktop Entry]
Type=Application
Name=DaVinci
GenericName=Pen plotter
Comment=Pen-plotter G-code for Bambu Lab printers
Exec="$BIN" %f
Icon=davinci
Terminal=false
Categories=Graphics;
MimeType=application/x-davinci;
StartupWMClass=davinci
DESKTOP

  refresh_desktop
  if have xdg-mime; then xdg-mime default davinci.desktop application/x-davinci >/dev/null 2>&1 || true; fi
  say "Installed the desktop app: DaVinci is in your applications menu, and .davinci files open in it."
}

install_server() {
  port="$1"
  mkdir -p "$UNIT_DIR"
  cat >"$UNIT_DIR/$UNIT" <<UNITFILE
[Unit]
Description=DaVinci web server (serves DaVinci to browsers on the network)

[Service]
ExecStart="$BIN" --serve --host 0.0.0.0 --port $port
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
UNITFILE

  if ! user_systemd; then
    say "Installed $UNIT_DIR/$UNIT, but this session has no systemd user manager to start it."
    say "Start the server by hand with: $BIN --serve --host 0.0.0.0 --port $port"
    return
  fi
  systemctl --user daemon-reload
  systemctl --user enable "$UNIT" >/dev/null 2>&1
  systemctl --user restart "$UNIT"
  sleep 1
  if ! systemctl --user is-active --quiet "$UNIT"; then
    say "The web server did not start. Its log: journalctl --user -u $UNIT"
    return
  fi
  say "Installed the web server ($UNIT). It is running and starts when you log in."
  say "Open DaVinci in a browser:"
  say "  On this computer:  http://127.0.0.1:$port/"
  ips=$(hostname -I 2>/dev/null || ip -4 -o addr show scope global 2>/dev/null | awk '{ sub("/.*", "", $4); print $4 }' || true)
  for ip in $ips; do
    case "$ip" in
      *:* | 127.* | 169.254.*) ;;
      *) say "  On your network:   http://$ip:$port/" ;;
    esac
  done
  if have ufw && ufw status 2>/dev/null | grep -q '^Status: active'; then
    say "ufw is on: let other computers in with  sudo ufw allow $port/tcp"
  fi
  say "To keep it running while you are logged out:  loginctl enable-linger $(id -un)"
}

# ----------------------------------------------------------------------------------------------------------------
# Command line
# ----------------------------------------------------------------------------------------------------------------
mode=
port=
case "$(basename "$0")" in
  uninstall.sh) mode=uninstall ;;
esac
while [ $# -gt 0 ]; do
  case "$1" in
    --app) mode=app ;;
    --server) mode=server ;;
    --both) mode=both ;;
    --uninstall) mode=uninstall ;;
    --port) [ $# -ge 2 ] || die "--port needs a number"; port=$2; shift ;;
    --port=*) port=${1#--port=} ;;
    -h | --help) usage ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
  shift
done

[ "$(id -u)" -ne 0 ] || die "run this as yourself, not as root: it installs for your user."

if [ "$mode" = uninstall ]; then
  remove_all
  say "DaVinci is uninstalled. Your projects and settings in $CONFIG/DaVinci are still there."
  exit 0
fi

[ "$(uname -m)" = x86_64 ] || die "this build is for x86_64 Linux."

if [ -z "$mode" ]; then
  [ -t 0 ] || die "choose --app, --server or --both (no terminal to ask in)."
  say "DaVinci $VERSION"
  say ""
  say "What would you like to install?"
  say "  1) The desktop app"
  say "  2) The web server: serves DaVinci to browsers on your network"
  say "  3) Both"
  printf 'Choice [3]: '
  read -r answer
  case "${answer:-3}" in
    1) mode=app ;;
    2) mode=server ;;
    3) mode=both ;;
    *) die "no such choice: $answer" ;;
  esac
  if [ "$mode" != app ] && [ -z "$port" ]; then
    printf 'Port for the web server [%s]: ' "$DEFAULT_PORT"
    read -r port
  fi
fi
port=${port:-$DEFAULT_PORT}
case "$port" in
  '' | *[!0-9]*) die "the port must be a number" ;;
esac
[ "$port" -ge 1024 ] && [ "$port" -le 65535 ] || die "choose a port from 1024 to 65535"

# Unpack the app (the archive after the __PAYLOAD__ line below)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
line=$(awk '/^__PAYLOAD__$/ { print NR + 1; exit }' "$0")
tail -n +"$line" "$0" | tar -xz -C "$tmp" || die "the installer is damaged: download it again"

say "Installing DaVinci $VERSION in $HOME_DIR"
remove_server
remove_desktop
install_app "$tmp"
head -n "$((line - 2))" "$0" >"$HOME_DIR/uninstall.sh"
chmod 755 "$HOME_DIR/uninstall.sh"
case "$mode" in
  app) install_desktop ;;
  server) install_server "$port" ;;
  both)
    install_desktop
    install_server "$port"
    ;;
esac
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) say "Add ~/.local/bin to your PATH to run \`davinci\` from a terminal." ;;
esac
say "Uninstall with: sh $HOME_DIR/uninstall.sh"
exit 0
__PAYLOAD__
