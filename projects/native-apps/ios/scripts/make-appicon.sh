#!/usr/bin/env bash
#
# Regenerate the 1024x1024 App Store marketing icon from the Readplace brand mark
# (a navy serif ampersand on white with the warm-amber marker dot resting on
# its palm terminal, per the brand guidelines). Vector geometry matches the canonical brand logo SVG; it is
# inlined here so this experiment stays self-contained (it depends on no other
# project at build time).
#
# Two steps, both with tools already on the machine (no ImageMagick/rsvg needed):
#   1. sips rasterises the SVG to a crisp 1024px PNG.
#   2. CoreGraphics re-encodes it WITHOUT an alpha channel — App Store marketing
#      icons are rejected if they carry alpha, even when fully opaque.

set -euo pipefail
cd "$(dirname "$0")/.."

OUT="App/Resources/Assets.xcassets/AppIcon.appiconset/Icon-1024.png"
TMP_SVG="build/icon-src.svg"
TMP_PNG="build/icon-rgba.png"
mkdir -p "$(dirname "$OUT")" build

cat > "$TMP_SVG" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="1024" height="1024">
  <rect x="0" y="0" width="512" height="512" fill="#ffffff"/>
  <path d="M204.28 400Q159.02 400 134.54 383.62Q110.07 363.57 110.07 326.4Q110.07 304.69 119.27 290.89Q128.47 277.09 143.19 268.26Q157.91 259.42 174.84 252.8Q160.12 235.87 153.5 221.89Q146.87 207.9 146.87 190.98Q146.87 164.11 165.09 148.84Q183.3 133.57 220.84 133.57Q245.86 133.57 261.32 140.74Q276.78 147.92 283.95 159.7Q291.13 171.47 291.13 185.82Q291.13 208.27 277.51 222.62Q263.9 236.98 235.56 250.22L290.39 308.74Q293.34 298.43 294.62 285Q295.91 271.57 295.91 259.42V243.23H314C325 243.23 337 230.15 344 230.15C348 230.15 350 231.2 353 231.2C356 231.2 359 229.95 362.5 229.95C369.2 229.95 374.6 235.4 374.6 242C374.6 246.6 371.9 250.6 367.6 251.8C356.85 254.8 344.24 265.44 338.78 269.91Q332.71 274.88 329.77 286.29Q326.82 296.59 322.78 308Q318.73 319.41 313.21 331.55L350.01 369.82Q355.9 376.45 363.81 378.47Q371.72 380.5 381.29 380.5H384.6V400H311.74L284.14 371.3Q271.62 384.54 251.75 394.11Q231.88 400 204.28 400ZM220.1 233.66Q235.19 224.83 242.18 213.98Q249.18 203.12 249.18 186.19Q249.18 172.21 242.55 163.93Q235.93 155.65 222.68 155.65Q209.8 155.65 202.81 163.74Q195.82 171.84 195.82 186.56Q195.82 199.07 202.07 209.93Q208.33 220.78 220.1 233.66ZM214.95 378.29Q232.62 378.29 246.05 370.93Q259.48 363.57 267.94 353.26L190.66 270.83Q177.78 280.03 171.9 293.46Q166.01 306.9 166.01 325.66Q166.01 350.69 179.44 364.49Q192.87 378.29 214.95 378.29Z" fill="#2B3A55"/>
  <circle cx="353" cy="182" r="44" fill="#C8923C"/>
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
