#!/bin/sh
# Only disposable extraction: the graphical setup handles explicit installation.
set -eu
mode=${1-}
case "$#:$mode" in
  0: | 1:--preview | 1:--verify | 1:--smoke-test) ;;
  1:--help) printf '%s\n' 'Dexerion Setup' 'Run without arguments to install, or use --preview, --verify, or --smoke-test.'; exit 0 ;;
  *) printf '%s\n' 'Unknown Setup option. Use --help.' >&2; exit 2 ;;
esac
umask 077
work=$(mktemp -d "${TMPDIR:-/tmp}/dexerion-setup.XXXXXXXX")
trap 'rm -rf -- "$work"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Shell builtins execute only the header, never the embedded bytes.
tail -n +__ARCHIVE_LINE__ -- "$0" | tar --no-same-owner --no-same-permissions -xzf - -C "$work"
(
  cd -- "$work"
  sha256sum --check --status SHA256SUMS || { printf '%s\n' 'The Dexerion AppImage checksum does not match.' >&2; exit 1; }
)
if [ ! -x "$work/runtime/dexerion-setup" ] || [ ! -r "$work/runtime/resources/app/main.cjs" ]; then
  printf '%s\n' 'The Dexerion Setup runtime is incomplete.' >&2
  exit 1
fi
if [ "$mode" = --verify ]; then
  printf '%s\n' 'Dexerion Setup archive and AppImage checksum verified.'
  exit 0
fi
if [ "$(id -u)" -eq 0 ]; then
  printf '%s\n' 'Run Dexerion Setup as your regular user, without sudo.' >&2
  exit 1
fi
unset ELECTRON_RUN_AS_NODE NODE_OPTIONS NODE_PATH
export DEX_SETUP_ROOT="$work"
export DEX_SETUP_MODE="$mode"
# Avoid writing Setup-only state or caches into the real browser profile.
export DEX_SETUP_ORIGINAL_CACHE_HOME="${XDG_CACHE_HOME-}"
export DEX_SETUP_ORIGINAL_CONFIG_HOME="${XDG_CONFIG_HOME-}"
export DEX_SETUP_ORIGINAL_DATA_HOME="${XDG_DATA_HOME-}"
export XDG_CACHE_HOME="$work/cache"
export XDG_CONFIG_HOME="$work/config"
export XDG_DATA_HOME="$work/data"
"$work/runtime/dexerion-setup"
exit $?
