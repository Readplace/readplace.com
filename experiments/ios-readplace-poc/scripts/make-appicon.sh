#!/usr/bin/env bash
#
# Regenerate the 1024x1024 App Store marketing icon from the Readplace brand mark
# (a navy serif ampersand on white with a warm-amber marker dot — see
# BRAND_GUIDELINES.md). Vector geometry matches projects/hutch/brand/
# Readplace_Logo_only.svg; it is inlined here so this experiment stays
# self-contained (it depends on no other project at build time).
#
# Two steps, both with tools already on the machine (no ImageMagick/rsvg needed):
#   1. sips rasterises the SVG to a crisp 1024px PNG.
#   2. CoreGraphics re-encodes it WITHOUT an alpha channel — App Store marketing
#      icons are rejected if they carry alpha, even when fully opaque.
#
# Usage:  ./scripts/make-appicon.sh

set -euo pipefail
cd "$(dirname "$0")/.."

OUT="App/Resources/Assets.xcassets/AppIcon.appiconset/Icon-1024.png"
TMP_SVG="build/icon-src.svg"
TMP_PNG="build/icon-rgba.png"
mkdir -p "$(dirname "$OUT")" build

cat > "$TMP_SVG" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" width="1024" height="1024">
  <rect x="0" y="0" width="500" height="500" fill="#ffffff"/>
  <text x="240" y="400" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="400" font-weight="700" fill="#2B3A55">&amp;</text>
  <circle cx="339" cy="146" r="38" fill="#C8923C"/>
</svg>
SVG

sips -s format png --resampleHeightWidth 1024 1024 "$TMP_SVG" --out "$TMP_PNG" >/dev/null

# Flatten alpha against the real Xcode toolchain (the devbox nix SDK is scrubbed).
env -u CC -u CXX -u CPP -u LD -u SDKROOT -u MACOSX_DEPLOYMENT_TARGET \
	DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
	PATH="/usr/bin:/bin:/usr/sbin:/sbin" \
	swift - "$TMP_PNG" "$OUT" <<'SWIFT'
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let src = CommandLine.arguments[1], dst = CommandLine.arguments[2]
guard let imgSrc = CGImageSourceCreateWithURL(URL(fileURLWithPath: src) as CFURL, nil),
      let img = CGImageSourceCreateImageAtIndex(imgSrc, 0, nil) else { exit(1) }
let n = img.width
let space = CGColorSpaceCreateDeviceRGB()
guard let ctx = CGContext(data: nil, width: n, height: n, bitsPerComponent: 8, bytesPerRow: 0,
                          space: space, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { exit(1) }
ctx.setFillColor(CGColor(colorSpace: space, components: [1, 1, 1, 1])!)
ctx.fill(CGRect(x: 0, y: 0, width: n, height: n))
ctx.draw(img, in: CGRect(x: 0, y: 0, width: n, height: n))
guard let flat = ctx.makeImage(),
      let out = CGImageDestinationCreateWithURL(URL(fileURLWithPath: dst) as CFURL, UTType.png.identifier as CFString, 1, nil)
else { exit(1) }
CGImageDestinationAddImage(out, flat, nil)
guard CGImageDestinationFinalize(out) else { exit(1) }
SWIFT

rm -f "$TMP_SVG" "$TMP_PNG"
echo "Wrote $OUT"
