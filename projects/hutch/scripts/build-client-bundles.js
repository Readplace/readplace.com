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
      "  setTimeoutFn: function (cb, ms) { return window.setTimeout(cb, ms); },",
      "  clearTimeoutFn: function (id) { window.clearTimeout(id); }",
      "}).attach();",
    ].join("\n"),
  },
  {
    entry: path.join(PROJECT_ROOT, "src/runtime/web/shared/clipboard-copy/clipboard-copy.client.ts"),
    outfile: path.join(OUT_DIR, "inbox.client.js"),
    globalName: "ClipboardCopy",
    footer: [
      "ClipboardCopy.initClipboardCopy({",
      "  document: window.document,",
      "  navigator: window.navigator,",
      "  setTimeoutFn: function (cb, ms) { return window.setTimeout(cb, ms); },",
      "  clearTimeoutFn: function (id) { window.clearTimeout(id); },",
      "  copySelector: '[data-inbox-copy]',",
      "  textAttr: 'data-inbox-address'",
      "}).attach();",
    ].join("\n"),
  },
  {
    entry: path.join(PROJECT_ROOT, "src/runtime/web/shared/clipboard-copy/clipboard-copy.client.ts"),
    outfile: path.join(OUT_DIR, "install.client.js"),
    globalName: "ClipboardCopy",
    footer: [
      "ClipboardCopy.initClipboardCopy({",
      "  document: window.document,",
      "  navigator: window.navigator,",
      "  setTimeoutFn: function (cb, ms) { return window.setTimeout(cb, ms); },",
      "  clearTimeoutFn: function (id) { window.clearTimeout(id); },",
      "  copySelector: '[data-install-copy]',",
      "  textAttr: 'data-install-text'",
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
    entry: path.join(PROJECT_ROOT, "src/runtime/web/pages/home/home.client.ts"),
    outfile: path.join(OUT_DIR, "home.client.js"),
    globalName: "HomeClient",
    footer: [
      "document.addEventListener('DOMContentLoaded', function () {",
      "  HomeClient.initHeadlineRotator({",
      "    document: window.document,",
      "    prefersReducedMotion: function () {",
      "      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;",
      "    },",
      "    setTimeoutFn: function (cb, ms) { return window.setTimeout(cb, ms); },",
      "    clearTimeoutFn: function (id) { window.clearTimeout(id); },",
      "    addVisibilityListener: function (cb) {",
      "      window.document.addEventListener('visibilitychange', cb);",
      "    },",
      "    isHidden: function () { return window.document.visibilityState === 'hidden'; }",
      "  });",
      "  HomeClient.initScrollHint({",
      "    document: window.document,",
      "    prefersReducedMotion: function () {",
      "      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;",
      "    },",
      "    scrollTo: function (y) { window.scrollTo(0, y); },",
      "    pageYOffset: function () { return window.pageYOffset; },",
      "    now: function () { return window.performance.now(); },",
      "    requestAnimationFrame: function (cb) { return window.requestAnimationFrame(cb); },",
      "    computedHeaderTop: function (header) {",
      "      return parseFloat(window.getComputedStyle(header).top);",
      "    }",
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
      "src/runtime/web/shared/article-body/reader-slot/reader-iframe.client.ts",
    ),
    outfile: path.join(OUT_DIR, "reader-iframe.client.js"),
    globalName: "ReaderIframe",
    footer: [
      "ReaderIframe.initReaderIframes({",
      "  document: window.document,",
      "  ResizeObserver: window.ResizeObserver,",
      "  MutationObserver: window.MutationObserver,",
      "  addSwapListener: function (listener) {",
      "    window.document.body.addEventListener('htmx:afterSwap', listener);",
      "  }",
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
      "src/runtime/web/shared/extension-suggestion-banner/extension-suggestion-banner.client.ts",
    ),
    outfile: path.join(OUT_DIR, "extension-suggestion-banner.client.js"),
    globalName: "ExtensionSuggestionBanner",
    footer: [
      "document.addEventListener('DOMContentLoaded', function () {",
      "  ExtensionSuggestionBanner.initExtensionSuggestionBanner({",
      "    document: window.document,",
      "    storage: window.localStorage",
      "  }).attach();",
      "});",
    ].join("\n"),
  },
  {
    entry: path.join(
      PROJECT_ROOT,
      "src/runtime/web/experiments/homepage-split.client.ts",
    ),
    outfile: path.join(OUT_DIR, "homepage-split.client.js"),
    globalName: "HomepageSplit",
    footer: [
      // Runs after the document parses (defer), then location.replace's to the
      // assigned arm. It is a client redirect, not a pre-paint one: a bucketed
      // guest may briefly see `/` before the arm loads, and emits a second
      // pageview for the arm. randomByte draws one unsigned byte from the CSPRNG
      // (no Math.random). Bots never receive this script (gated server-side).
      "HomepageSplit.initHomepageSplit({",
      "  config: HomepageSplit.HOMEPAGE_SPLIT,",
      "  location: window.location,",
      "  storage: window.localStorage,",
      "  randomByte: function () { return window.crypto.getRandomValues(new Uint8Array(1))[0]; }",
      "});",
    ].join("\n"),
  },
  {
    entry: path.join(
      PROJECT_ROOT,
      "src/runtime/web/trial-countdown.client.ts",
    ),
    outfile: path.join(OUT_DIR, "trial-countdown.client.js"),
    globalName: "TrialCountdown",
    footer: [
      "document.addEventListener('DOMContentLoaded', function () {",
      "  TrialCountdown.initTrialCountdown({",
      "    document: window.document,",
      "    now: function () { return Date.now(); },",
      "    timeZone: function () { return Intl.DateTimeFormat().resolvedOptions().timeZone; },",
      "    setIntervalFn: function (cb, ms) { return window.setInterval(cb, ms); },",
      "    clearIntervalFn: function (id) { window.clearInterval(id); },",
      "    addSwapListener: function (cb) { document.body.addEventListener('htmx:afterSwap', cb); }",
      "  }).attach();",
      "});",
    ].join("\n"),
  },
  {
    entry: path.join(PROJECT_ROOT, "src/runtime/web/local-time.client.ts"),
    outfile: path.join(OUT_DIR, "local-time.client.js"),
    globalName: "LocalTime",
    footer: [
      // Loaded globally with `defer`, so the DOM is parsed before this runs
      // and the initial scan sees every server-rendered baseline. The swap
      // listener re-localises instants that arrive inside a swapped <main>.
      "LocalTime.initLocalTime({",
      "  document: window.document,",
      "  timeZone: function () { return Intl.DateTimeFormat().resolvedOptions().timeZone; },",
      "  addSwapListener: function (cb) { document.body.addEventListener('htmx:afterSwap', cb); }",
      "}).attach();",
    ].join("\n"),
  },
  {
    entry: path.join(
      PROJECT_ROOT,
      "src/runtime/web/pages/view/expiry-counter.client.ts",
    ),
    outfile: path.join(OUT_DIR, "expiry-counter.client.js"),
    globalName: "ExpiryCounter",
    footer: [
      "document.addEventListener('DOMContentLoaded', function () {",
      "  ExpiryCounter.initExpiryCounter({",
      "    document: window.document,",
      "    now: function () { return Date.now(); },",
      "    setIntervalFn: function (cb, ms) { return window.setInterval(cb, ms); },",
      "    clearIntervalFn: function (id) { window.clearInterval(id); }",
      "  });",
      "});",
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
      "src/runtime/web/pages/view/view-paywall.client.ts",
    ),
    outfile: path.join(OUT_DIR, "view-paywall.client.js"),
    globalName: "ViewPaywall",
    footer: [
      "document.addEventListener('DOMContentLoaded', function () {",
      "  ViewPaywall.initViewPaywall({",
      "    document: window.document,",
      "    window: window,",
      "    now: function () { return Date.now(); },",
      "    setTimeoutFn: function (cb, ms) { return window.setTimeout(cb, ms); },",
      "    clearTimeoutFn: function (id) { window.clearTimeout(id); }",
      "  });",
      "});",
    ].join("\n"),
  },
  {
    entry: path.join(PROJECT_ROOT, "src/runtime/web/webmcp.client.ts"),
    outfile: path.join(OUT_DIR, "webmcp.client.js"),
    globalName: "WebMcp",
    footer: [
      // The WebMCP context lives on navigator in Chrome's preview and on
      // document in the W3C draft; pass whichever exists. Saving navigates
      // to the same /save entrypoint the UI uses, so the agent's save and a
      // human click are one code path.
      "var mcNav = window.navigator && window.navigator.modelContext;",
      "var mcDoc = window.document && window.document.modelContext;",
      "WebMcp.initWebMcp({",
      "  modelContext: mcNav || mcDoc || null,",
      "  navigateTo: function (url) { window.location.assign(url); }",
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
  {
    entry: path.join(
      PROJECT_ROOT,
      "src/runtime/web/pages/queue/queue-focus.client.ts",
    ),
    outfile: path.join(OUT_DIR, "queue-focus.client.js"),
    globalName: "QueueFocus",
    footer: [
      // htmx:beforeSwap fires on the element about to be swapped; the queue's
      // card mutations (POST) remove the card the user acted on, so this
      // re-homes focus after the swap settles. The request verb rides along so
      // the script can ignore a pending card's 3s self-poll (GET), which
      // re-renders the card in place rather than removing it. Both listeners
      // live on body so they survive the target's own removal.
      "QueueFocus.initQueueFocus({",
      "  document: window.document,",
      "  addBeforeSwapListener: function (cb) { window.document.body.addEventListener('htmx:beforeSwap', function (e) { cb({ target: e.target, verb: e.detail.requestConfig.verb }); }); },",
      "  addAfterSettleListener: function (cb) { window.document.body.addEventListener('htmx:afterSettle', cb); }",
      "});",
    ].join("\n"),
  },
  {
    entry: path.join(
      PROJECT_ROOT,
      "src/runtime/web/shared/toast/toast.client.ts",
    ),
    outfile: path.join(OUT_DIR, "toast.client.js"),
    globalName: "Toast",
    footer: [
      // Loaded with `defer`, so the DOM is parsed before this runs and the
      // initial scan sees any toast already in the document. afterSwap catches
      // a toast that arrives inside a swapped <main>; oobAfterSwap catches one
      // delivered out-of-band (the card-scoped status mutation), whose primary
      // target is removed so afterSwap may fire on a detached node and never
      // reach body.
      "Toast.initToastDismiss({",
      "  document: window.document,",
      "  setTimeoutFn: function (cb, ms) { return window.setTimeout(cb, ms); },",
      "  addSwapListener: function (cb) { document.body.addEventListener('htmx:afterSwap', cb); document.body.addEventListener('htmx:oobAfterSwap', cb); }",
      "});",
    ].join("\n"),
  },
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

  if (watch) {
    const contexts = await Promise.all(
      BUNDLES.map((b) => esbuild.context(buildOptions(b))),
    );
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log("build-client-bundles: watching for changes...");
    return;
  }

  await Promise.all(BUNDLES.map((b) => esbuild.build(buildOptions(b))));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
