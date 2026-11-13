## Logo

### The Icon

The icon is a serif **"&"** (ampersand) in white on a navy (`#2B3A55`) rounded square, its crossbar ending in a soft upturned palm on which a single warm amber (`#C8923C`) dot rests. The ampersand stands for *this and that*, *now and later*, *your articles and the time to read them*. The dot is the marker — the place you left off, the place you'll come back to.

The mark carries a second, quieter reading: the ampersand is a person sitting — one hand resting on the floor (the bowl and foot share one implied floor line), the other raised, holding the amber globe up to look at it. The globe is the web, read as it is. Both readings coexist; neither may be strengthened at the cost of the mark reading as a dignified ampersand first.

The glyph is **fixed `<path>` geometry** (Noto Serif Bold outlines, OFL-licensed, with the palm and floor edits from the July 2026 mark review). Never render the mark with a `<text>` element — the glyph shape would then depend on whatever fonts the rendering machine has installed, which is how the brand once shipped five different ampersands (Georgia, DejaVu, Liberation Serif, and two visitor-dependent SVGs) without anyone choosing them.

### Assets

Every raster asset is generated — never hand-rendered — by `projects/hutch/scripts/generate-brand-assets.mjs` from the vector sources of truth (`brandMarkSvg` in `@packages/web-shell`, `favicon.svg` — whose glyph a test holds equal to `brandMarkSmallSvg` in the same package — and the path-based lockup masters in `projects/hutch/brand/`). To change the mark, change those sources and re-run the script; do not edit or screen-render individual PNGs (screen renders bake the generating monitor's subpixel fringing into the brand).

| Asset | Sizes available | Location |
|---|---|---|
| **Favicon** | 16, 32 (dotless), 48, 96px + multi-entry `.ico` | `projects/hutch/static-assets/favicon-*.png` |
| **Apple Touch Icon** | 57–180px, opaque full-bleed (iOS applies its own mask) | `projects/hutch/static-assets/apple-touch-icon-*.png` |
| **Android Chrome** | 48–512px + full-bleed maskable variants | `projects/hutch/static-assets/android-chrome-*.png` |
| **Windows Tile** | 70, 150, 310×150 (lockup), 310px | `projects/hutch/static-assets/mstile-*.png` |
| **Social cards** | 1200×630 (OG), 1200×600 (Twitter) | `projects/hutch/static-assets/og-image-*.png`, `twitter-card-*.png` |
| **Extension icons** | 16–128px, light (white halo) + dark themes | `projects/browser-extensions/{chrome,firefox}-extension/src/icons/{light,dark}/icon-*.png` |
| **iOS and Android login mark + iOS App Store icon** | 72–216px + 1024px | `projects/native-apps/ios/scripts/make-brandmark.sh` (writes the iOS `BrandMark` image set and the Android `brand_mark.png` drawables), `make-appicon.sh` |
| **Android launcher icon** | Vector adaptive icon (any size) | `projects/native-apps/android/app/src/main/res/drawable/ic_launcher_foreground.xml`, the ampersand path and the amber dot's circle path beside it (an arc starting at cx+r) both pasted by hand from the source geometry; no script renders it |

### Usage Rules

- **Minimum clear space:** Maintain padding equal to at least the diameter of the amber dot on all sides of the icon.
- **Internal clear space (amended July 2026):** Inside the mark, keep ≥ 0.20 dot-diameters between the dot's rim and all glyph ink — **except the palm seat**, which is deliberately near-tangent (a 4.65-unit hairline seam at 512) so the globe rests *on* the hand at every size that carries the dot.
- **Size cutover:** The amber dot ships only at renders **≥ 33px**. Below that (the 16–32px favicon class) use the dotless small-size variant (`favicon.svg` geometry — glyph enlarged 12%, no dot), served on the web as `brandMarkSmallSvg` from `@packages/web-shell` or `/embed/icon-small.svg`. A dot at those sizes is a smudge that collides with the glyph.
- **Do not** rotate, skew, add drop shadows, apply gradients, or place on busy photographic backgrounds.
- **Do not** recreate or approximate the logo — always use the provided assets.
- **Do not** remove or reposition the amber dot, recolour the ampersand, or change the navy background fill.
- **Backgrounds:** The mark already contains its navy rounded-square tile — keep the full mark intact on both light and dark surfaces rather than swapping fills.
- **Keyline (part of the mark):** The tile carries a hairline white keyline (`#FFFFFF` at 40% opacity, ~1px rendered) stroked on its edge. It is present on every surface and alpha-composites against whatever sits behind the mark, so the navy tile stays delineated at ≥3:1 contrast on dark/navy surfaces (blog/web header in dark mode, extension popup, the navy hero, a dark browser tab strip) where an opaque navy tile would otherwise dissolve into the background. It is imperceptible on light surfaces (the tile is already ~11:1 there), so it is always on. **Do not** remove it, and never lighten the navy fill to compensate — the keyline is what makes the mark legible on dark, not a fill change.
- **`Readplace_Logo_only.svg` is not a web asset.** `projects/hutch/brand/Readplace_Logo_only.svg` is a tile-less navy ampersand kept only as source geometry for the iOS and Android app marks. It has no tile and no keyline, so on web or dark surfaces the navy glyph would vanish — never render it there. Use the full mark everywhere on the web (`brandMarkSvg` from `@packages/web-shell`, `favicon.svg`, or `/embed/icon.svg`), and its dotless small-size variant below the size cutover (`brandMarkSmallSvg`, or `/embed/icon-small.svg`).
