#!/usr/bin/env bash
# Boot the packaged WebPi Desktop artifact and let the shell's smoke mode verify
# it (it starts its own service, loads the UI, prints `[smoke] …`, then quits).
#
#   WEBPI_DESKTOP_SMOKE=1 bash desktop/smoke-packaged.sh
#
# The platform is decided by which artifact electron-builder produced, not by
# `uname` (Git Bash reports different things per distribution). The artifact is
# located with a wildcard on purpose: renaming the product (build.productName)
# renames the executable, the .app bundle and the AppImage, and this script must
# not need an edit when that happens.
set -euo pipefail

cd "$(dirname "$0")/.."

fail() {
  echo "smoke: $1" >&2
  echo "smoke: release/ contains:" >&2
  ls -R release 2>/dev/null | head -40 >&2 || true
  exit 1
}

if [ -d ./release/win-unpacked ]; then
  exe=$(ls ./release/win-unpacked/*.exe 2>/dev/null | head -1 || true)
  [ -n "$exe" ] || fail "no executable in release/win-unpacked"
  echo "smoke: $exe"
  "$exe"
elif ls -d ./release/mac*/*.app >/dev/null 2>&1; then
  # The macOS runner is arm64, so prefer that bundle; it is the one that boots.
  bundle=$(ls -d ./release/mac-arm64/*.app 2>/dev/null | head -1 || true)
  [ -n "$bundle" ] || bundle=$(ls -d ./release/mac*/*.app 2>/dev/null | head -1)
  exe="$bundle/Contents/MacOS/$(basename "$bundle" .app)"
  [ -x "$exe" ] || fail "no executable at $exe"
  echo "smoke: $exe"
  "$exe"
elif ls ./release/*-linux-*.AppImage >/dev/null 2>&1; then
  app=$(ls ./release/*-linux-*.AppImage 2>/dev/null | head -1)
  echo "smoke: $app"
  xvfb-run -a "$app" --appimage-extract-and-run --no-sandbox
else
  fail "no packaged artifact found under release/"
fi
