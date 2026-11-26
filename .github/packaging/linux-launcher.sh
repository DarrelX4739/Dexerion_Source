#!/bin/sh
# Packaging entry point only: the application and app.asar are not modified.
set -eu
# Debian launchers may be reached through /usr/bin/dexerion symlinks.
launcher_path=$(readlink -f -- "$0")
launcher_dir=$(CDPATH= cd -- "$(dirname -- "$launcher_path")" && pwd -P)
binary="$launcher_dir/dexerion-bin"

# Respect an explicit backend choice, including the two-argument spelling.
for argument do
  case "$argument" in
    --ozone-platform|--ozone-platform=*) exec "$binary" "$@" ;;
  esac
done

# KDE/Wayland can activate/reposition Electron's inactive suggestion windows.
# Prefer XWayland when available; do not force X11 on Wayland-only systems.
if [ -n "${DISPLAY:-}" ]; then
  if [ "${XDG_SESSION_TYPE:-}" = wayland ] || [ -n "${WAYLAND_DISPLAY:-}" ]; then
    exec "$binary" --ozone-platform=x11 "$@"
  fi
fi
exec "$binary" "$@"
