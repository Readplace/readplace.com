#!/usr/bin/env bash
#
# Regenerate the login screen's Readplace brand mark — the serif ampersand with
# the warm-amber marker dot (see BRAND_GUIDELINES.md) — as the transparent
# `BrandMark` image set that LoginView shows above the title. Vector geometry
# matches projects/hutch/brand/Readplace_Logo_only.svg; it is inlined here so this
# script depends on no other project at build time, mirroring make-appicon.sh.
#
# The light variant draws the navy ampersand from Readplace_Logo_only.svg; the
# dark variant draws the white ampersand from the dark slogan lockup
# (Readplace_Background_with_slogan.svg) so the mark stays legible on the dark
# login background. The amber dot is constant in both. The 500x500 viewBox is
# kept so the mark's brand clear-space (>= the amber dot's diameter per side) is
# preserved. Output is @1x/2x/3x for the 72pt frame in LoginView.
#
# The mark KEEPS its alpha — it sits directly on the login background — so there
# is no flatten step; rsvg-convert writes RGBA straight to the image set. (The
# App Store icon in make-appicon.sh is the opposite case: it must drop alpha, and
# does so on macOS via CoreGraphics.)
#
# Rasterised on the repo's Linux devbox shell with rsvg-convert (librsvg) — NOT
# macOS sips, which is unavailable here and would also substitute Times New Roman
# for the glyph and change the ampersand outline. The font is pinned to Liberation
# Serif, the metric-compatible serif that stands in for the 'Times New Roman' in
# the logo SVG's own font stack; both librsvg and the liberation_ttf font are
# provided by devbox (see devbox.json) so the committed PNGs reproduce from this
# script.
#
# Usage: run this script from the devbox shell.

set -euo pipefail
cd "$(dirname "$0")/.."

OUT_DIR="App/Resources/Assets.xcassets/BrandMark.imageset"
TMP_SVG="build/brandmark-src.svg"
mkdir -p "$OUT_DIR" build

render() { # $1=ampersand fill  $2=size px  $3=output filename
	cat > "$TMP_SVG" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" width="$2" height="$2">
  <text x="240" y="400" text-anchor="middle" font-family="Liberation Serif" font-size="400" font-weight="700" fill="$1">&amp;</text>
  <circle cx="339" cy="146" r="38" fill="#C8923C"/>
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
