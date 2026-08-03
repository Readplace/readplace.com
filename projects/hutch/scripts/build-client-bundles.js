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
 * Page bundles ride *inside* <main> (injectPageScriptsIntoMain in web-shell) so
 * an htmx boosted navigation re-executes them on the destination page — htmx
 * clones and runs scripts inside the swapped subtree and drops the rest. That
 * re-execution means a bootstrap that registers a document.body swap listener
 * (or a rAF loop) must run at most once per document, or every same-page swap
 * (mark-read, filter) would stack another listener. `runOnce` gates the factory
 * on a per-outfile window flag; the factory's own swap listener, registered on
 * that first run, handles every later swap. Global bundles (toast, local-time,
 * webmcp, trial-countdown, extension-suggestion-banner) stay outside <main> and
 * load once, so they keep bare footers with no guard.
 */
function runOnce(flag, body) {
  return `if (!window.${flag}) {
  window.${flag} = true;
${body}
}`;
}

/**
 * Like runOnce, but for a footer that must wait for the DOM. A bare
 * DOMContentLoaded listener never fires on a boosted arrival — htmx runs the
 * cloned script after DOMContentLoaded has already passed — so gate on
 * readyState instead, the same run-now-or-on-DCL shape the queue's
 * AUTO_SUBMIT_SCRIPT uses.
 */
function runOnceOnReady(flag, body) {
  return runOnce(
    flag,
    `  (function () {
    function run() {
${body}
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run, { once: true });
    } else {
      run();
    }
  })();`,
  );
}

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
    footer: runOnce(
      "__shareBalloonInit",
      [
        "ShareBalloon.initBoostedPageBundle({",
        "  document: window.document,",
        "  selector: '[data-share-balloon-wrap]',",
        "  addSwapListener: function (listener) {",
        "    window.document.body.addEventListener('htmx:afterSwap', function (e) { listener(e.target); });",
        "  },",
        "  create: function () {",
        "    var controller = ShareBalloon.initShareBalloon({",
        "      window: window,",
        "      document: window.document,",
        "      storage: window.localStorage,",
        "      navigator: window.navigator,",
        "      setTimeoutFn: function (cb, ms) { return window.setTimeout(cb, ms); },",
        "      clearTimeoutFn: function (id) { window.clearTimeout(id); }",
        "    });",
        "    controller.attach();",
        "    return function () { controller.detach(); };",
        "  }",
        "});",
      ].join("\n"),
    ),
  },
  {
    entry: path.join(
      PROJECT_ROOT,
      "src/runtime/web/shared/article-body/progress-bar.client.ts",
    ),
    outfile: path.join(OUT_DIR, "progress-bar.client.js"),
    globalName: "ProgressBar",
    footer: runOnce(
      "__progressBarInit",
      [
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
    ),
  },
  {
    entry: path.join(
      PROJECT_ROOT,
      "src/runtime/web/pages/reader/reader-nav.client.ts",
    ),
    outfile: path.join(OUT_DIR, "reader-nav.client.js"),
    globalName: "ReaderNav",
    footer: runOnce(
      "__readerNavInit",
      [
        "ReaderNav.initReaderNav({",
        "  document: window.document,",
        "  window: window,",
        "  addSwapListener: function (listener) {",
        "    window.document.body.addEventListener('htmx:afterSwap', listener);",
        "  }",
        "});",
      ].join("\n"),
    ),
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
    entry: path.join(PROJECT_ROOT, "src/runtime/web/pages/home/home.client.ts"),
    outfile: path.join(OUT_DIR, "home.client.js"),
    globalName: "HomeClient",
    footer: runOnceOnReady(
      "__homeInit",
      [
        "  HomeClient.initBoostedPageBundle({",
        "    document: window.document,",
        "    selector: '.hero-headline__rotator',",
        "    addSwapListener: function (listener) {",
        "      window.document.body.addEventListener('htmx:afterSwap', function (e) { listener(e.target); });",
        "    },",
        "    create: function () {",
        "      var rotator = HomeClient.initHeadlineRotator({",
        "        document: window.document,",
        "        prefersReducedMotion: function () {",
        "          return window.matchMedia('(prefers-reduced-motion: reduce)').matches;",
        "        },",
        "        setTimeoutFn: function (cb, ms) { return window.setTimeout(cb, ms); },",
        "        clearTimeoutFn: function (id) { window.clearTimeout(id); },",
        "        addVisibilityListener: function (cb) {",
        "          window.document.addEventListener('visibilitychange', cb);",
        "          return function () { window.document.removeEventListener('visibilitychange', cb); };",
        "        },",
        "        isHidden: function () { return window.document.visibilityState === 'hidden'; }",
        "      });",
        "      var sloganRotator = HomeClient.initSloganRotator({",
        "        document: window.document,",
        "        prefersReducedMotion: function () {",
        "          return window.matchMedia('(prefers-reduced-motion: reduce)').matches;",
        "        },",
        "        setTimeoutFn: function (cb, ms) { return window.setTimeout(cb, ms); },",
        "        clearTimeoutFn: function (id) { window.clearTimeout(id); },",
        "        addVisibilityListener: function (cb) {",
        "          window.document.addEventListener('visibilitychange', cb);",
        "          return function () { window.document.removeEventListener('visibilitychange', cb); };",
        "        },",
        "        isHidden: function () { return window.document.visibilityState === 'hidden'; }",
        "      });",
        "      HomeClient.initScrollHint({",
        "        document: window.document,",
        "        prefersReducedMotion: function () {",
        "          return window.matchMedia('(prefers-reduced-motion: reduce)').matches;",
        "        },",
        "        scrollTo: function (y) { window.scrollTo(0, y); },",
        "        pageYOffset: function () { return window.pageYOffset; },",
        "        now: function () { return window.performance.now(); },",
        "        requestAnimationFrame: function (cb) { return window.requestAnimationFrame(cb); },",
        "        computedHeaderTop: function (header) {",
        "          return parseFloat(window.getComputedStyle(header).top);",
        "        }",
        "      });",
        "      return function () { rotator.stop(); sloganRotator.stop(); };",
        "    }",
        "  });",
      ].join("\n"),
    ),
  },
  {
    entry: path.join(
      PROJECT_ROOT,
      "src/runtime/web/pages/import/import.client.ts",
    ),
    outfile: path.join(OUT_DIR, "import.client.js"),
    globalName: "ImportClient",
    footer: runOnce(
      "__importInit",
      [
        "ImportClient.initIndeterminateCheckboxes({",
        "  document: window.document,",
        "  addSwapListener: function (listener) {",
        "    window.document.body.addEventListener('htmx:afterSwap', listener);",
        "  }",
        "});",
        "ImportClient.initBoostedPageBundle({",
        "  document: window.document,",
        "  selector: 'form.import__upload-form',",
        "  addSwapListener: function (listener) {",
        "    window.document.body.addEventListener('htmx:afterSwap', function (e) { listener(e.target); });",
        "  },",
        "  create: function () {",
        "    ImportClient.initUploadProgress({",
        "      document: window.document,",
        "      formatBytes: ImportClient.formatBytes,",
        "      nativeSubmit: function (form) { form.submit(); }",
        "    });",
        "    return function () {};",
        "  }",
        "});",
      ].join("\n"),
    ),
  },
  {
    entry: path.join(
      PROJECT_ROOT,
      "src/runtime/web/pages/account/account-cards.client.ts",
    ),
    outfile: path.join(OUT_DIR, "account-cards.client.js"),
    globalName: "AccountCards",
    footer: runOnce(
      "__accountCardsInit",
      [
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
    ),
  },
  {
    entry: path.join(
      PROJECT_ROOT,
      "src/runtime/web/shared/article-body/crawl-bookmark/crawl-bookmark.client.ts",
    ),
    outfile: path.join(OUT_DIR, "crawl-bookmark.client.js"),
    globalName: "CrawlBookmark",
    footer: runOnce(
      "__crawlBookmarkInit",
      [
        "CrawlBookmark.initCrawlBookmark({",
        "  document: window.document,",
        "  isNarrow: function () { return window.matchMedia('(max-width: 767px)').matches; },",
        "  storage: window.localStorage,",
        "  addSwapListener: function (cb) { window.document.body.addEventListener('htmx:afterSwap', function (e) { cb(e.target); }); }",
        "}).attach();",
      ].join("\n"),
    ),
  },
  {
    entry: path.join(
      PROJECT_ROOT,
      "src/runtime/web/pages/view/expiry-counter.client.ts",
    ),
    outfile: path.join(OUT_DIR, "expiry-counter.client.js"),
    globalName: "ExpiryCounter",
    footer: runOnceOnReady(
      "__expiryCounterInit",
      [
        "  ExpiryCounter.initBoostedPageBundle({",
        "    document: window.document,",
        "    selector: '[data-expiry-state=\"counting\"]',",
        "    addSwapListener: function (listener) {",
        "      window.document.body.addEventListener('htmx:afterSwap', function (e) { listener(e.target); });",
        "    },",
        "    create: function () {",
        "      var controller = ExpiryCounter.initExpiryCounter({",
        "        document: window.document,",
        "        now: function () { return Date.now(); },",
        "        setIntervalFn: function (cb, ms) { return window.setInterval(cb, ms); },",
        "        clearIntervalFn: function (id) { window.clearInterval(id); }",
        "      });",
        "      return function () { controller.stop(); };",
        "    }",
        "  });",
      ].join("\n"),
    ),
  },
  {
    entry: path.join(
      PROJECT_ROOT,
      "src/runtime/web/pages/save/save-error.client.ts",
    ),
    outfile: path.join(OUT_DIR, "save-error.client.js"),
    globalName: "SaveErrorCountdown",
    footer: runOnceOnReady(
      "__saveErrorInit",
      [
        "  SaveErrorCountdown.initBoostedPageBundle({",
        "    document: window.document,",
        "    selector: '.save-error__seconds',",
        "    addSwapListener: function (listener) {",
        "      window.document.body.addEventListener('htmx:afterSwap', function (e) { listener(e.target); });",
        "    },",
        "    create: function () {",
        "      var controller = SaveErrorCountdown.initSaveErrorCountdown({",
        "        document: window.document,",
        "        setIntervalFn: function (cb, ms) { return window.setInterval(cb, ms); },",
        "        clearIntervalFn: function (id) { window.clearInterval(id); }",
        "      });",
        "      return function () { controller.stop(); };",
        "    }",
        "  });",
      ].join("\n"),
    ),
  },
  {
    entry: path.join(
      PROJECT_ROOT,
      "src/runtime/web/pages/view/view-paywall.client.ts",
    ),
    outfile: path.join(OUT_DIR, "view-paywall.client.js"),
    globalName: "ViewPaywall",
    footer: runOnceOnReady(
      "__viewPaywallInit",
      [
        "  ViewPaywall.initBoostedPageBundle({",
        "    document: window.document,",
        "    selector: '[data-view-paywall]',",
        "    addSwapListener: function (listener) {",
        "      window.document.body.addEventListener('htmx:afterSwap', function (e) { listener(e.target); });",
        "    },",
        "    create: function () {",
        "      var controller = ViewPaywall.initViewPaywall({",
        "        document: window.document,",
        "        window: window,",
        "        now: function () { return Date.now(); },",
        "        setTimeoutFn: function (cb, ms) { return window.setTimeout(cb, ms); },",
        "        clearTimeoutFn: function (id) { window.clearTimeout(id); },",
        "        dispatchDocumentEvent: function (type) { window.document.dispatchEvent(new Event(type)); }",
        "      });",
        "      return function () { controller.detach(); };",
        "    }",
        "  });",
      ].join("\n"),
    ),
  },
  {
    entry: path.join(
      PROJECT_ROOT,
      "src/runtime/web/shared/article-body/summary-slot/summary-toggle.client.ts",
    ),
    outfile: path.join(OUT_DIR, "summary-toggle.client.js"),
    globalName: "SummaryToggle",
    footer: runOnce(
      "__summaryToggleInit",
      [
        // navigator.sendBeacon keeps the request alive past the toggle even if
        // the reader navigates away immediately after; the swap listener re-binds
        // to the fresh <details> a poll response splices in.
        "SummaryToggle.initSummaryToggleBeacon({",
        "  document: window.document,",
        "  sendBeacon: function (url) { window.navigator.sendBeacon(url); },",
        "  addSwapListener: function (cb) { document.body.addEventListener('htmx:afterSwap', cb); }",
        "});",
      ].join("\n"),
    ),
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
