/**
 * Bundle the Electron app into a self-contained `app/` directory that mirrors
 * the dev layout (src/shell + src/renderer), so the relative paths used by the
 * main process resolve identically whether run from `dist/` in development or
 * from inside the packaged .app. Every workspace and npm dependency is bundled
 * in (only `electron` itself stays external), so the packaged app needs no
 * node_modules — which sidesteps electron-builder's trouble following pnpm's
 * symlinked workspace packages.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(projectRoot, "app");
const shellDir = join(appDir, "src", "shell");
const rendererDir = join(appDir, "src", "renderer");

rmSync(appDir, { recursive: true, force: true });
mkdirSync(shellDir, { recursive: true });

const shared = {
	bundle: true,
	platform: "node",
	format: "cjs",
	target: "node20",
	external: ["electron"],
	logLevel: "info",
};

await build({
	...shared,
	entryPoints: [join(projectRoot, "src/shell/app.main.ts")],
	outfile: join(shellDir, "app.main.js"),
});

await build({
	...shared,
	entryPoints: [join(projectRoot, "src/shell/preload.main.ts")],
	outfile: join(shellDir, "preload.main.js"),
});

cpSync(join(projectRoot, "src/shell/reader.css"), join(shellDir, "reader.css"));
cpSync(join(projectRoot, "src/shell/icon.png"), join(shellDir, "icon.png"));
cpSync(join(projectRoot, "src/renderer"), rendererDir, { recursive: true });

const pkg = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf-8"));
writeFileSync(
	join(appDir, "package.json"),
	`${JSON.stringify(
		{
			name: "internet-reader",
			productName: "Internet Reader",
			version: pkg.version,
			description: pkg.description,
			main: "src/shell/app.main.js",
		},
		null,
		2,
	)}\n`,
);

console.log(`[browser-macos] bundled self-contained app into ${appDir}`);
