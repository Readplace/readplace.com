const path = require("node:path");

const SRC_DIR = path.join(__dirname, "src");

const CLIPBOARD_COPY_ENTRY = path.join(
  SRC_DIR,
  "shared/clipboard-copy/clipboard-copy.client.ts",
);

function clipboardCopyFooter(copySelector, textAttr) {
  return [
    "ClipboardCopy.initClipboardCopy({",
    "  document: window.document,",
    "  navigator: window.navigator,",
    "  setTimeoutFn: function (cb, ms) { return window.setTimeout(cb, ms); },",
    "  clearTimeoutFn: function (id) { window.clearTimeout(id); },",
    `  copySelector: '${copySelector}',`,
    `  textAttr: '${textAttr}'`,
    "}).attach();",
  ].join("\n");
}

const SHARED_CLIENT_BUNDLES = [
  {
    outfile: "inbox.client.js",
    entry: CLIPBOARD_COPY_ENTRY,
    globalName: "ClipboardCopy",
    footer: clipboardCopyFooter("[data-inbox-copy]", "data-inbox-address"),
  },
  {
    outfile: "install.client.js",
    entry: CLIPBOARD_COPY_ENTRY,
    globalName: "ClipboardCopy",
    footer: clipboardCopyFooter("[data-install-copy]", "data-install-text"),
  },
  {
    outfile: "mcp.client.js",
    entry: CLIPBOARD_COPY_ENTRY,
    globalName: "ClipboardCopy",
    footer: clipboardCopyFooter("[data-mcp-copy]", "data-mcp-text"),
  },
  {
    outfile: "integrations.client.js",
    entry: CLIPBOARD_COPY_ENTRY,
    globalName: "ClipboardCopy",
    footer: clipboardCopyFooter("[data-integrations-copy]", "data-integrations-address"),
  },
  {
    outfile: "extension-suggestion-banner.client.js",
    entry: path.join(
      SRC_DIR,
      "shared/extension-suggestion-banner/extension-suggestion-banner.client.ts",
    ),
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
    outfile: "trial-countdown.client.js",
    entry: path.join(SRC_DIR, "trial-countdown.client.ts"),
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
    outfile: "local-time.client.js",
    entry: path.join(SRC_DIR, "local-time.client.ts"),
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
    outfile: "webmcp.client.js",
    entry: path.join(SRC_DIR, "webmcp.client.ts"),
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
    outfile: "toast.client.js",
    entry: path.join(SRC_DIR, "shared/toast/toast.client.ts"),
    globalName: "Toast",
    footer: [
      // Loaded with `defer`, so the DOM is parsed before this runs and the
      // initial scan sees any toast already in the document. The swap
      // listener catches toasts that arrive inside a swapped <main>; the
      // beforeRequest/afterSettle pair captures keyboard focus before
      // `hx-disabled-elt` blurs the pressed button and restores it once the
      // swapped-in markup is live, so an action never strands the reader at
      // the top of <main>.
      "Toast.initToastDismiss({",
      "  document: window.document,",
      "  setTimeoutFn: function (cb, ms) { return window.setTimeout(cb, ms); },",
      "  addSwapListener: function (cb) { document.body.addEventListener('htmx:afterSwap', cb); document.body.addEventListener('htmx:oobAfterSwap', cb); document.body.addEventListener('readplace:toast', cb); },",
      "  addBeforeRequestListener: function (cb) { document.body.addEventListener('htmx:beforeRequest', cb); },",
      "  addAfterSettleListener: function (cb) { document.body.addEventListener('htmx:afterSettle', cb); }",
      "});",
    ].join("\n"),
  },
];

module.exports = { SHARED_CLIENT_BUNDLES };
