/**
 * Bundle browser-side client modules into same-origin IIFE scripts.
 *
 * Why same-origin instead of STATIC_BASE_URL: the JS bundle changes per commit
 * and must ship with the server that renders the HTML. Routing through the CDN
 * meant any developer who pointed STATIC_BASE_URL at staging got a stale/404
 * response from CloudFront for the latest bundle.
 *
 * Output goes under `src/runtime/web/client-dist/` so the Lambda `copyAssetFiles`
 * step (everything in src/runtime that isn't .ts) ships it alongside the
 * handler, and it is also copied into the build output for test runs.
 *
 * client-dist is declared as an nx output of hutch:compile (project.json): it
 * lives outside dist/, so without that declaration a cache-replayed compile
 * skips recreating it and the Lambda zips build without the client bundles —
 * which made `pulumi preview` report code drift on every Lambda whenever the
 * preview ran on a warm nx cache while deploys built fresh. Renaming OUT_DIR
 * requires updating that outputs entry.
 */
const esbuild = require("esbuild");
const fs = require("node:fs");
const path = require("node:path");
const { SHARED_CLIENT_BUNDLES } = require("@packages/web-shell/client-bundles");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(PROJECT_ROOT, "src", "runtime", "web", "client-dist");

/**
 * 1. `globalName` exposes the module exports on `window.ShareBalloon` inside the IIFE.
 * 2. the appended footer runs *after* the IIFE body, calling the exported factory with
 *    the real browser globals. The wiring stays out of the source TS so the
 *    client module remains pure and unit-testable.
 * 3. `keepNames: false` — the only reason esbuild's `__name` helper caused the
 *    original bug was an inline `.toString()`; inside a self-contained IIFE the
 *    helper is harmless, but we don't need name preservation for runtime logic.
 */
const BUNDLES = [
  {
    entry: path.join(
      PROJECT_ROOT,
      "src/runtime/web/shared/share-balloon/share-balloon.client.ts",
    ),
    outfile: path.join(OUT_DIR, "share-balloon.client.js"),
    globalName: "ShareBalloon",
    footer: [
      "ShareBalloon.initShareBalloon({",
      "  window: window,",
      "  document: window.document,",
      "  storage: window.localStorage,",
      "  navigator: window.navigator,",
      "  sendBeacon: function (url) { window.navigator.sendBeacon(url); },",
      "  setTimeoutFn: function (cb, ms) { return window.setTimeout(cb, ms); },",
      "  clearTimeoutFn: function (id) { window.clearTimeout(id); },",
      "  addSwapListener: function (cb) {",
      "    window.document.body.addEventListener('htmx:afterSwap', cb);",
      "  },",
      "  removeSwapListener: function (cb) {",
      "    window.document.body.removeEventListener('htmx:afterSwap', cb);",
      "  }",
      "}).attach();",
    ].join("\n"),
  },
  {
    entry: path.join(
      PROJECT_ROOT,
      "src/runtime/web/shared/article-body/progress-bar.client.ts",
    ),
    outfile: path.join(OUT_DIR, "progress-bar.client.js"),
    globalName: "ProgressBar",
    footer: [
      // HTMX fires htmx:afterSwap on the container around any swapped node,
      // including OOB swaps targeting #article-body-progress. The listener
      // re-anchors the bar against the new (tickAt, pct) so the rAF loop
      // projects forward from there.
      "ProgressBar.initProgressBars({",
      "  document: window.document,",
      "  now: function () { return Date.now(); },",
      "  requestAnimationFrame: function (cb) { return window.requestAnimationFrame(cb); },",
      "  cancelAnimationFrame: function (id) { window.cancelAnimationFrame(id); },",
      "  addSwapListener: function (listener) {",
      "    window.document.body.addEventListener('htmx:afterSwap', listener);",
      "  }",
      "});",
    ].join("\n"),
  },
  {
    entry: path.join(
      PROJECT_ROOT,
      "src/runtime/web/pages/reader/reader-nav.client.ts",
    ),
    outfile: path.join(OUT_DIR, "reader-nav.client.js"),
    globalName: "ReaderNav",
    footer: [
      "ReaderNav.initReaderNav({",
      "  document: window.document,",
      "  window: window,",
      "  addSwapListener: function (listener) {",
      "    window.document.body.addEventListener('htmx:afterSwap', listener);",
      "  }",
      "});",
    ].join("\n"),
  },
  {
    entry: path.join(
      PROJECT_ROOT,
      "src/runtime/web/pages/reader/reader-exit-confirm.client.ts",
    ),
    outfile: path.join(OUT_DIR, "reader-exit-confirm.client.js"),
    globalName: "ReaderExitConfirm",
    footer: [
      "ReaderExitConfirm.initReaderExitConfirm({",
      "  document: window.document,",
      "  supportsPopover: function () { return typeof HTMLElement.prototype.showPopover === 'function'; },",
      "  showPopover: function (panel) { panel.showPopover(); },",
      "  hidePopover: function (panel) { panel.hidePopover(); },",
      "  fetchFn: function (url, init) { return window.fetch(url, init); },",
      "  navigate: function (href) { window.location.assign(href); }",
      "});",
    ].join("\n"),
  },
  {
    entry: path.join(
      PROJECT_ROOT,
      "src/runtime/web/shared/save-tip/save-tip.client.ts",
    ),
    outfile: path.join(OUT_DIR, "save-tip.client.js"),
    globalName: "SaveTip",
    footer: [
      "SaveTip.initSaveTip({",
      "  document: window.document,",
      "  supportsPopover: function () { return typeof HTMLElement.prototype.showPopover === 'function'; },",
      "  showPopover: function (panel) { panel.showPopover(); },",
      "  hidePopover: function (panel) { panel.hidePopover(); },",
      "  navigate: function (href) { window.location.assign(href); },",
      "  isSecureTransport: function () { return window.location.protocol === 'https:'; },",
      "  writeCookie: function (cookie) { window.document.cookie = cookie; },",
      "  sendBeacon: function (url) { window.navigator.sendBeacon(url); }",
      "});",
    ].join("\n"),
  },
  {
    entry: path.join(
      PROJECT_ROOT,
      "src/runtime/web/shared/page-depth/page-depth.client.ts",
    ),
    outfile: path.join(OUT_DIR, "page-depth.client.js"),
    globalName: "PageDepthClient",
    footer: [
      "document.addEventListener('DOMContentLoaded', function () {",
      "  var el = window.document.querySelector('[data-page-depth-beacon]');",
      "  if (!el) { return; }",
      "  PageDepthClient.initPageDepth({",
      "    addClickListener: function (cb) { window.document.addEventListener('click', cb, true); },",
      "    addSubmitListener: function (cb) { window.document.addEventListener('submit', cb, true); },",
      "    addScrollListener: function (cb) { window.addEventListener('scroll', cb, { passive: true }); },",
      "    addLeaveListener: function (cb) {",
      "      window.addEventListener('pagehide', cb);",
      "      window.document.addEventListener('visibilitychange', function () {",
      "        if (window.document.visibilityState === 'hidden') { cb(); }",
      "      });",
      "    },",
      "    anchorHrefFromEvent: function (e) {",
      "      var t = e.target;",
      "      var a = t && t.closest ? t.closest('a') : null;",
      "      return a ? a.getAttribute('href') : null;",
      "    },",
      "    scrollY: function () { return window.scrollY; },",
      "    viewportHeight: function () { return window.innerHeight; },",
      "    documentHeight: function () { return window.document.documentElement.scrollHeight; },",
      "    sendBeacon: function (url) { window.navigator.sendBeacon(url); },",
      "    beaconUrl: el.getAttribute('data-page-depth-beacon'),",
      "    exitKinds: { leftSite: 'left_site', navigatedOnward: 'navigated_onward' }",
      "  });",
      "});",
    ].join("\n"),
  },
  {
    entry: path.join(
      PROJECT_ROOT,
      "src/runtime/web/pages/import/import.client.ts",
    ),
    outfile: path.join(OUT_DIR, "import.client.js"),
    globalName: "ImportClient",
    footer: [
      "ImportClient.initIndeterminateCheckboxes({",
      "  document: window.document,",
      "  addSwapListener: function (listener) {",
      "    window.document.body.addEventListener('htmx:afterSwap', listener);",
      "  }",
      "});",
      "ImportClient.initUploadProgress({",
      "  document: window.document,",
      "  formatBytes: ImportClient.formatBytes,",
      "  nativeSubmit: function (form) { form.submit(); }",
      "});",
    ].join("\n"),
  },
  {
    entry: path.join(
      PROJECT_ROOT,
      "src/runtime/web/pages/account/account-cards.client.ts",
    ),
    outfile: path.join(OUT_DIR, "account-cards.client.js"),
    globalName: "AccountCards",
    footer: [
      // Stripe.js must load from js.stripe.com for PCI SAQ-A — it is the one
      // allowed cross-origin script. This loader injects that tag on demand,
      // then returns the Stripe instance bound to the publishable key the
      // server rendered into the Elements container's data-* attributes.
      "AccountCards.initAccountCards({",
      "  document: window.document,",
      "  loadStripe: function (publishableKey) {",
      "    return new Promise(function (resolve, reject) {",
      "      if (window.Stripe) { resolve(window.Stripe(publishableKey)); return; }",
      "      var script = window.document.createElement('script');",
      "      script.src = 'https://js.stripe.com/v3/';",
      "      script.onload = function () { resolve(window.Stripe(publishableKey)); };",
      "      script.onerror = function () { reject(new Error('Failed to load Stripe.js')); };",
      "      window.document.head.appendChild(script);",
      "    });",
      "  },",
      "  confirmAdd: function (confirmInput) {",
      "    var form = window.document.createElement('form');",
      "    form.method = 'POST';",
      "    form.action = '/account/cards/confirm';",
      "    var input = window.document.createElement('input');",
      "    input.type = 'hidden';",
      "    input.name = 'setupId';",
      "    input.value = confirmInput.setupId;",
      "    form.appendChild(input);",
      "    window.document.body.appendChild(form);",
      "    form.submit();",
      "  },",
      "  addSettleListener: function (cb) { window.document.body.addEventListener('htmx:afterSettle', cb); }",
      "});",
    ].join("\n"),
  },
  {
    entry: path.join(
      PROJECT_ROOT,
      "src/runtime/web/shared/article-body/crawl-bookmark/crawl-bookmark.client.ts",
    ),
    outfile: path.join(OUT_DIR, "crawl-bookmark.client.js"),
    globalName: "CrawlBookmark",
    footer: [
      "CrawlBookmark.initCrawlBookmark({",
      "  document: window.document,",
      "  isNarrow: function () { return window.matchMedia('(max-width: 767px)').matches; },",
      "  storage: window.localStorage,",
      "  addSwapListener: function (cb) { window.document.body.addEventListener('htmx:afterSwap', function (e) { cb(e.target); }); }",
      "}).attach();",
    ].join("\n"),
  },
  {
    entry: path.join(
      PROJECT_ROOT,
      "src/runtime/web/pages/save/save-error.client.ts",
    ),
    outfile: path.join(OUT_DIR, "save-error.client.js"),
    globalName: "SaveErrorCountdown",
    footer: [
      "document.addEventListener('DOMContentLoaded', function () {",
      "  SaveErrorCountdown.initSaveErrorCountdown({",
      "    document: window.document,",
      "    setIntervalFn: function (cb, ms) { return window.setInterval(cb, ms); },",
      "    clearIntervalFn: function (id) { window.clearInterval(id); }",
      "  });",
      "});",
    ].join("\n"),
  },
  {
    entry: path.join(
      PROJECT_ROOT,
      "src/runtime/web/shared/next-read/next-read.client.ts",
    ),
    outfile: path.join(OUT_DIR, "next-read.client.js"),
    globalName: "NextRead",
    footer: [
      "NextRead.initNextRead({",
      "  document: window.document,",
      "  viewportHeight: function () { return window.innerHeight; },",
      "  addScrollListener: function (cb) { window.addEventListener('scroll', cb, { passive: true }); },",
      "  removeScrollListener: function (cb) { window.removeEventListener('scroll', cb); },",
      "  addSwapListener: function (cb) { window.document.body.addEventListener('htmx:afterSwap', cb); },",
      "  removeSwapListener: function (cb) { window.document.body.removeEventListener('htmx:afterSwap', cb); }",
      "}).attach();",
    ].join("\n"),
  },
  {
    entry: path.join(
      PROJECT_ROOT,
      "src/runtime/web/pages/readlist/readlist-rename.client.ts",
    ),
    outfile: path.join(OUT_DIR, "readlist-rename.client.js"),
    globalName: "ReadlistRename",
    footer: [
      "ReadlistRename.initReadlistRename({",
      "  document: window.document,",
      "  fetchFn: function (url, init) { return window.fetch(url, init); },",
      "  placeCaretAtEnd: function (element) {",
      "    var range = window.document.createRange();",
      "    range.selectNodeContents(element);",
      "    range.collapse(false);",
      "    var selection = window.getSelection();",
      "    selection.removeAllRanges();",
      "    selection.addRange(range);",
      "  },",
      "  announceToast: function (toast) {",
      "    toast.dispatchEvent(new Event('readplace:toast', { bubbles: true }));",
      "  },",
      "  addSwapListener: function (cb) {",
      "    window.document.body.addEventListener('htmx:afterSwap', cb);",
      "    window.document.body.addEventListener('htmx:historyRestore', cb);",
      "  }",
      "});",
    ].join("\n"),
  },
  {
    entry: path.join(
      PROJECT_ROOT,
      "src/runtime/web/shared/article-body/summary-slot/summary-toggle.client.ts",
    ),
    outfile: path.join(OUT_DIR, "summary-toggle.client.js"),
    globalName: "SummaryToggle",
    footer: [
      // navigator.sendBeacon keeps the request alive past the toggle even if
      // the reader navigates away immediately after; the swap listener re-binds
      // to the fresh <details> a poll response splices in.
      "SummaryToggle.initSummaryToggleBeacon({",
      "  document: window.document,",
      "  sendBeacon: function (url) { window.navigator.sendBeacon(url); },",
      "  addSwapListener: function (cb) { document.body.addEventListener('htmx:afterSwap', cb); }",
      "});",
    ].join("\n"),
  },
];

const ALL_BUNDLES = [
  ...SHARED_CLIENT_BUNDLES.map((bundle) => ({
    ...bundle,
    outfile: path.join(OUT_DIR, bundle.outfile),
  })),
  ...BUNDLES,
];

function buildOptions(bundle) {
  return {
    entryPoints: [bundle.entry],
    outfile: bundle.outfile,
    bundle: true,
    format: "iife",
    globalName: bundle.globalName,
    footer: { js: bundle.footer },
    target: ["es2020"],
    platform: "browser",
    keepNames: false,
    minify: false,
    sourcemap: true,
    logLevel: "info",
  };
}

async function main() {
  const watch = process.argv.includes("--watch");

  // Drop orphan output files from renamed or removed client entries — c8 would
  // otherwise pick them up as 0%-coverage sources and silently fail the gate.
  fs.rmSync(OUT_DIR, { recursive: true, force: true });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.copyFileSync(
    require.resolve("htmx.org/dist/htmx.min.js"),
    path.join(OUT_DIR, "htmx.client.js"),
  );

  if (watch) {
    const contexts = await Promise.all(
      ALL_BUNDLES.map((b) => esbuild.context(buildOptions(b))),
    );
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log("build-client-bundles: watching for changes...");
    return;
  }

  await Promise.all(ALL_BUNDLES.map((b) => esbuild.build(buildOptions(b))));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
