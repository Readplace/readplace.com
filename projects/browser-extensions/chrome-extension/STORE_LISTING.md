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

The shots are real production captures, not mockups. `02`, `03`, `04` and the
marquee come from one command, and `01` is the save-confirmation frame of the
Chrome recording:

```sh
pnpm nx run hutch:compile
SCREENSHOTS_ACCOUNT_EMAIL=… SCREENSHOTS_ACCOUNT_PASSWORD=… pnpm --filter hutch media stills
```

The toolkit captures at `deviceScaleFactor: 2`, strips the banners and the
onboarding card from the DOM, burns in the red callout, downscales, and flattens
to opaque RGB — the specs above are asserted on every write. Its runbook,
including the prerequisites and what to check on the account first, is
`projects/hutch/scripts/media/README.md`.

## Firefox

The Firefox extension is a listed add-on on AMO
(https://addons.mozilla.org/firefox/addon/readplace/), published by
`.github/workflows/publish-firefox-extension.yml`. Its text metadata lives in
`projects/browser-extensions/firefox-extension/amo-metadata.json` and is sent
on every publish, so edit it there, not in the Developer Hub. Icon, screenshots
and the privacy-policy text are managed by hand in the Developer Hub; the same
shots above serve Firefox, uploaded in the same order.
