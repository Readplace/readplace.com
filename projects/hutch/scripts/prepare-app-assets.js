/**
 * Mirror @packages/app's compiled browser bundles + llms text files into hutch's
 * src/runtime/ tree so they ride along when:
 *   1. local dev resolves __dirname/web/client-dist (tsx runs from src/runtime/),
 *   2. copy-static-assets.js copies non-TS files from src/ to dist/,
 *   3. HutchLambda's assetDir copies src/runtime/ into the Lambda bundle root.
 *
 * Without this, the browser bundles produced by @packages/app/scripts/build-client-bundles.js
 * are stranded inside the @packages/app workspace and never reach the Lambda
 * package or the dev server's express.static mount.
 */
const fs = require("node:fs");
const path = require("node:path");

const APP_DIST = path.dirname(require.resolve("@packages/app/package.json")) + "/dist";
const HUTCH_SRC_RUNTIME = path.resolve(__dirname, "../src/runtime");

const APP_CLIENT_DIST = path.join(APP_DIST, "web/client-dist");
const HUTCH_CLIENT_DIST = path.join(HUTCH_SRC_RUNTIME, "web/client-dist");

if (!fs.existsSync(APP_CLIENT_DIST)) {
	throw new Error(
		`prepare-app-assets: ${APP_CLIENT_DIST} does not exist. Run \`pnpm --filter @packages/app compile\` (or \`nx build @packages/app\`) before hutch's compile.`,
	);
}

fs.rmSync(HUTCH_CLIENT_DIST, { recursive: true, force: true });
fs.mkdirSync(HUTCH_CLIENT_DIST, { recursive: true });

let copied = 0;
for (const file of fs.readdirSync(APP_CLIENT_DIST)) {
	fs.copyFileSync(
		path.join(APP_CLIENT_DIST, file),
		path.join(HUTCH_CLIENT_DIST, file),
	);
	copied++;
}

console.log(
	`prepare-app-assets: mirrored ${copied} client-dist file(s) from ${path.relative(process.cwd(), APP_CLIENT_DIST)} into ${path.relative(process.cwd(), HUTCH_CLIENT_DIST)}`,
);
