#!/usr/bin/env bash
#
# Wrap the built web extension (dist-extension-compiled/) into a Safari App
# Extension Xcode project using Apple's safari-web-extension-converter.
#
# Requires macOS with Xcode installed (provides `xcrun`). This step CANNOT run
# on Linux/CI — it is the only Safari-specific, non-portable part of the POC.
#
# Usage (on a Mac):
#   pnpm --filter safari-extension compile      # builds dist-extension-compiled/
#   bash scripts/wrap-safari.sh                 # generates dist-safari-app/
#   open dist-safari-app/Readplace/Readplace.xcodeproj
#
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXT_DIR="$PROJECT_DIR/dist-extension-compiled"
OUT_DIR="$PROJECT_DIR/dist-safari-app"

if [ ! -d "$EXT_DIR" ]; then
  echo "error: $EXT_DIR not found. Build the extension first: pnpm compile" >&2
  exit 1
fi

if ! command -v xcrun >/dev/null 2>&1; then
  echo "error: xcrun not found. This script requires macOS with Xcode installed." >&2
  exit 1
fi

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

xcrun safari-web-extension-converter "$EXT_DIR" \
  --project-location "$OUT_DIR" \
  --app-name "Readplace" \
  --bundle-identifier "com.readplace.safari" \
  --swift \
  --copy-resources \
  --no-open \
  --force

echo ""
echo "Safari app project generated under: $OUT_DIR"
echo "Open it in Xcode and Run to install the host app + enable the extension in Safari."
