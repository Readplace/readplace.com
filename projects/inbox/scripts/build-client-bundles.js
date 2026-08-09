const esbuild = require("esbuild");
const fs = require("node:fs");
const path = require("node:path");
const { SHARED_CLIENT_BUNDLES } = require("@packages/web-shell/client-bundles");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(PROJECT_ROOT, "src", "runtime", "web", "client-dist");

const RENDERED_BY_INBOX_PAGES = new Set([
  "extension-suggestion-banner.client.js",
  "inbox.client.js",
  "local-time.client.js",
  "toast.client.js",
  "trial-countdown.client.js",
  "webmcp.client.js",
]);

const BUNDLES = SHARED_CLIENT_BUNDLES.filter((bundle) =>
  RENDERED_BY_INBOX_PAGES.has(bundle.outfile),
).map((bundle) => ({ ...bundle, outfile: path.join(OUT_DIR, bundle.outfile) }));

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
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.copyFileSync(
    require.resolve("htmx.org/dist/htmx.min.js"),
    path.join(OUT_DIR, "htmx.client.js"),
  );
  await Promise.all(BUNDLES.map((b) => esbuild.build(buildOptions(b))));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
