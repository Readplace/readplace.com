# Media capture toolkit

Regenerates every committed image and video that shows the Readplace UI. Captures run against
**production**, signed in as the screenshots account, so the cards carry real thumbnails, excerpts
and summaries.

## Prerequisites

| Requirement | Why |
|---|---|
| `pnpm nx run hutch:compile` | the scripts import `@packages/e2e-harness` and `@packages/require-env` from `dist` |
| `ffmpeg` on PATH (`brew install ffmpeg`) | scaling, cropping and the H.264 encode |
| `cwebp` on PATH (`brew install webp`) | WebP output; this ffmpeg has no libwebp encoder |
| `SCREENSHOTS_ACCOUNT_EMAIL`, `SCREENSHOTS_ACCOUNT_PASSWORD` | the account every signed-in capture uses |

## Commands

| Command | Produces |
|---|---|
| `pnpm --filter hutch media stills` | every still in `media.json` |
| `pnpm --filter hutch media stills --only queue.webp` | one still, repeatable |
| `pnpm --filter hutch media desktop chrome-save-demo --dry-run` | a screenshot before each click, to correct the coordinates |
| `pnpm --filter hutch media desktop chrome-save-demo` | records the take and writes `take.json` |
| `pnpm --filter hutch media encode chrome-save-demo --take <take.json>` | the mp4, its poster and a contact sheet |

A take drives the real cursor and records the whole screen, so the Mac cannot be
used while one runs. Turn on a Focus first: a notification banner lands in the
frame otherwise.

## Browser profiles for the extension recordings

Each recording starts from a profile that already has the extension installed
and signed in, with the toolbar icon **unpinned** — pinning it is what the
recording teaches. Prepare each one once; the driver refuses to record if the
extension is already pinned.

| Browser | Prepare |
|---|---|
| Chrome | Launch with `--user-data-dir="$CHROME_PROFILE_DIR" --no-first-run --no-default-browser-check` on the Web Store listing, click **Add to Chrome** then **Add extension**, dismiss the bubble so the icon stays unpinned, then open `chrome-extension://<id>/popup/popup.template.html?url=https://readplace.com/queue` and sign in through the popup's own **Log in to Readplace** |
| Firefox | Download the signed XPI named by `latest.txt` in the extension's S3 bucket, launch with `-no-remote -profile "$FIREFOX_PROFILE_DIR"` on `file://<the xpi>`, click **Add**, unpin the toolbar button Firefox adds, then open the popup page as above and sign in |

Opening the popup with `?url=` pointing at the app itself shows the list view
rather than saving anything, so signing in costs the account no stray article.
Before each re-record, delete the demo article from the readlist — a second save
of the same link reports "Already in your readlist" instead of "Article saved".

## Before capturing

| Check | Why |
|---|---|
| The account's To Read tab shows thumbnail cards at the top | the readlist stills are the top of that list |
| `openArticleTitled` in `media.json` names an article on the account whose TL;DR is ready | the reader stills expand that summary |
| Run the stills before any video take | a video take saves an article, which would top the readlist without a thumbnail |

Each capture writes one anonymous import session (the import still) and one summary-toggle beacon
(the reader stills) to production.

## How it works

`media.json` is the whole configuration: `stills` names the pages and viewports, `outputs` names
the committed files and how each is composed. Every capture is taken at `deviceScaleFactor: 2`
and downscaled, so the burned-in callout lands at the stroke weight the file needs — 7px on the
1440-wide web stills, 9px on the 1280x800 store stills, `#FF3B30` throughout. Callout geometry
comes from the live element's bounding box, so a layout change moves the ring with it. Banners,
the onboarding card and other account-state chrome are removed from the DOM before the shot
(`volatile` in `media.json`). Intermediate files land in `test-results/media/`, which is ignored.

## Verifying

`file` every output: the stills are `1440 x 900` WebP, `1200 x 630` and `1280 x 800` 8-bit RGB PNG
(App Store and Chrome Web Store both reject alpha), the marquee `1400 x 560`. Then look at each
one: no `My Queue` heading, the nav reads Readlist / Import Links / Inbox, and the callout sits on
the control its caption names.
