# Internet Reader

A macOS desktop browser that renders the open web in Readplace's clean reader view. It
embeds Chromium (via Electron) for real web rendering, but every page you open is fetched
and stripped to a distraction-free reading view by the **same** extraction logic the
Readplace server uses — running entirely on your machine, under the app's own user agent,
with no cloud backend.

## How it works

Navigation is reader-first. You type a link, the main process fetches it and extracts the
article, and the clean view appears immediately; the globe button (🌐) drops to the raw
live page. Links you click inside an article stay in reader view. Back / Forward / Reload
are Chromium's own session history over the `reader://` pages.

```
address bar ─▶ reader://page/?u=<url> ─▶ protocol handler ─▶ reader pipeline ─▶ clean HTML
                                                              │
        @packages/crawl-article  (fetch: net.fetch + browser personas, h2/curl fallbacks)
        @packages/article-parser (Mozilla Readability + Medium / The Information pre-parsers)
        reader-document.ts       (brand-styled document + a script-blocking CSP)
```

The reusable extraction logic is the Readplace workspace packages; this project adds only
the browser shell around them.

## Architecture

- `src/core/` — pure, Electron-free, 100% unit-tested logic: address normalization, the
  `reader://` URL scheme, the reader pipeline (composes the workspace packages), reader and
  failure document rendering, the user agent, and the native menu template.
- `src/shell/` — the Electron glue: `app.main.ts` (composition root: window, `reader://`
  protocol handler, IPC, `<webview>` control, native menu) and `preload.main.ts` (the
  `contextBridge` API). The main process is the brain; the renderer is a thin toolbar.
- `src/renderer/` — `index.html`, `chrome.css`, and `chrome.client.js` (the toolbar UI),
  plus `reader.css` (the reading view styles, read by the main process at runtime).

Everything that imports `electron` or touches the DOM lives in `*.main.ts` / `*.browser.ts`
/ `*.client.js`, which the coverage gate excludes; all logic lives in plain `*.ts` at 100%.

## Develop

```bash
pnpm nx run browser-macos:compile   # build (also builds the workspace deps)
pnpm --filter browser-macos start   # launch the app from dist/
pnpm nx run browser-macos:check     # lint + biome + knip + tests + 100% coverage gate
```

## Package an installable app

```bash
pnpm --filter browser-macos package
```

Produces `dist-app/Internet Reader-darwin-arm64/Internet Reader.app`: a self-contained,
**unsigned** macOS app. Drag it to `/Applications`; on first launch, right-click → Open to
get past Gatekeeper (unsigned). The build bundles every dependency in with esbuild, so the
packaged app carries no `node_modules`.

## Limitations (POC)

- Sites behind aggressive TLS-fingerprint blocking (some Cloudflare origins) fall through to
  `curl-impersonate`, which Readplace ships as a Lambda layer but isn't installed locally —
  those show a friendly "couldn't open" page. Most sites work on `net.fetch` alone.
- PDFs are not extracted (the server's PDF path needs the OCR provider); they fail gracefully.
- Single window with one tab.
