#!/usr/bin/env bash
#
# Regenerate the login screen's Readplace brand mark — the serif ampersand with
# the warm-amber marker dot resting on the palm terminal (see
# BRAND_GUIDELINES.md) — as the transparent `BrandMark` image set that
# LoginView shows above the title. Vector geometry matches
# projects/hutch/brand/Readplace_Logo_only.svg; it is inlined here so this
# script depends on no other project at build time, mirroring make-appicon.sh.
#
# The glyph is fixed <path> outline data (Noto Serif Bold, OFL, with the
# palm/floor edits from the 2026 mark review), so no installed font can change
# the mark — this script renders byte-identical pixels on any machine with
# librsvg. The light variant draws the ampersand in navy for the light login
# background; the dark variant draws it in white. The amber dot is constant.
#
# The mark KEEPS its alpha — it sits directly on the login background — so there
# is no flatten step; rsvg-convert writes RGBA straight to the image set. (The
# App Store icon in make-appicon.sh is the opposite case: it must drop alpha, and
# does so on macOS via CoreGraphics.)
#
# Usage: run this script from the devbox shell (rsvg-convert comes from devbox).

set -euo pipefail
cd "$(dirname "$0")/.."

OUT_DIR="App/Resources/Assets.xcassets/BrandMark.imageset"
TMP_SVG="build/brandmark-src.svg"
mkdir -p "$OUT_DIR" build

AMPERSAND_PATH="M204.28 400Q159.02 400 134.54 383.62Q110.07 363.57 110.07 326.4Q110.07 304.69 119.27 290.89Q128.47 277.09 143.19 268.26Q157.91 259.42 174.84 252.8Q160.12 235.87 153.5 221.89Q146.87 207.9 146.87 190.98Q146.87 164.11 165.09 148.84Q183.3 133.57 220.84 133.57Q245.86 133.57 261.32 140.74Q276.78 147.92 283.95 159.7Q291.13 171.47 291.13 185.82Q291.13 208.27 277.51 222.62Q263.9 236.98 235.56 250.22L290.39 308.74Q293.34 298.43 294.62 285Q295.91 271.57 295.91 259.42V243.23H314C325 243.23 337 230.15 344 230.15C348 230.15 350 231.2 353 231.2C356 231.2 359 229.95 362.5 229.95C369.2 229.95 374.6 235.4 374.6 242C374.6 246.6 371.9 250.6 367.6 251.8C356.85 254.8 344.24 265.44 338.78 269.91Q332.71 274.88 329.77 286.29Q326.82 296.59 322.78 308Q318.73 319.41 313.21 331.55L350.01 369.82Q355.9 376.45 363.81 378.47Q371.72 380.5 381.29 380.5H384.6V400H311.74L284.14 371.3Q271.62 384.54 251.75 394.11Q231.88 400 204.28 400ZM220.1 233.66Q235.19 224.83 242.18 213.98Q249.18 203.12 249.18 186.19Q249.18 172.21 242.55 163.93Q235.93 155.65 222.68 155.65Q209.8 155.65 202.81 163.74Q195.82 171.84 195.82 186.56Q195.82 199.07 202.07 209.93Q208.33 220.78 220.1 233.66ZM214.95 378.29Q232.62 378.29 246.05 370.93Q259.48 363.57 267.94 353.26L190.66 270.83Q177.78 280.03 171.9 293.46Q166.01 306.9 166.01 325.66Q166.01 350.69 179.44 364.49Q192.87 378.29 214.95 378.29Z"

render() { # $1=ampersand fill  $2=size px  $3=output filename
	cat > "$TMP_SVG" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="$2" height="$2">
  <path d="$AMPERSAND_PATH" fill="$1"/>
  <circle cx="353" cy="182" r="44" fill="#C8923C"/>
</svg>
SVG
	rsvg-convert --width "$2" --height "$2" "$TMP_SVG" --output "$OUT_DIR/$3"
}

render "#2B3A55" 72  "BrandMark.png"
render "#2B3A55" 144 "BrandMark@2x.png"
render "#2B3A55" 216 "BrandMark@3x.png"
render "#FFFFFF" 72  "BrandMark-Dark.png"
render "#FFFFFF" 144 "BrandMark-Dark@2x.png"
render "#FFFFFF" 216 "BrandMark-Dark@3x.png"

rm -f "$TMP_SVG"
echo "Wrote 6 PNGs to $OUT_DIR"
