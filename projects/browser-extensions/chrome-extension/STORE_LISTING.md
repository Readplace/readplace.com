# Chrome Web Store listing

The publish pipeline (`.github/workflows/publish-chrome-extension.yml`) automates
only the extension **package** (the zip). Everything on the store **listing** —
screenshots, description, promo tile — is managed by hand in the
[Chrome Web Store dashboard](https://chrome.google.com/webstore/devconsole)
(item `klblengmhlfnmjoagchagfcdbpbocgbf`; the store URL is a
shipped wire contract pinned in `src/packages/supported-clients`).

## Screenshots

`store-assets/` holds the current set, ready to upload as-is:

| File | Suggested caption (for the listing description) |
|---|---|
| `01-save-from-extension.png` | One click saves the full page you're reading — not just the link. |
| `02-queue.png` | Everything waits in one readlist, with a short AI preview of every save. |
| `03-reader-tldr.png` | Read without the clutter — with a TL;DR before you commit. |
| `04-import-links.png` | Moving from Pocket or a folder of tabs? Paste a link and import everything. |
| `05-most-complete-version.png` | Readplace keeps the most complete version of what you saved. |

Upload in that order: dashboard → the item → **Store listing** → *Graphic assets*
→ Screenshots. The dashboard has no caption field; captions belong in the
listing description text if used.

## Promotional images

Same *Graphic assets* section, separate slots below the screenshots:

| File | Dashboard slot |
|---|---|
| `promo-tile-440x280.png` | Small promo tile (440×280) |
| `promo-marquee-1400x560.png` | Marquee promo tile (1400×560) |

Chrome uses these on discovery surfaces (category pages, the homepage
carousel), so a listing without them is rarely featured. Both are built from
the brand lockup in `og-image-1200x630.png` (navy `#2B3A55`, white serif
ampersand with the `#C8923C` dot, Georgia wordmark); the marquee adds the real
readlist capture in a framed card. Same specs as screenshots: opaque RGB PNG.

**Specs (checked into this set):** exactly 1280×800, opaque RGB PNG — no alpha
channel. Apple's media pipeline hangs forever on PNGs with alpha (see
`projects/native-apps/ios/RELEASING.md`); Chrome is more forgiving, but flat sRGB
is safe everywhere, so keep the constraint.

## Regenerating the set

The shots are real production captures, not mockups:

1. Sign in at readplace.com as the screenshots account (a real account seeded
   with well-crawled articles — Quanta, The New Yorker, Wikipedia — so cards
   carry real thumbnails, excerpts, and AI summaries).
2. Capture at a 1280×800 viewport (Playwright at `deviceScaleFactor: 2`, then
   downscale to 1280×800). Strip the trial countdown/banners from the DOM
   before shooting — they are account-state noise, not product.
3. `01` is a composite of two real captures: the popup driven as a page at
   `chrome-extension://<id>/popup/popup.template.html?url=<article>` (the
   `?url=` param triggers a real save; build with `pnpm compile` so the popup
   talks to production), over an article-page capture.
4. Flatten to opaque RGB and resize to exactly 1280×800 before committing.

## Firefox

There is **no AMO listing**: the Firefox extension is signed with
`--channel=unlisted` and self-hosted from S3 (see
`submit-ff-extension-for-signing.yml`), so no store screenshots exist for it.
The same shots serve Firefox users on `/install?client=firefox`.
