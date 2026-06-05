import baseConfig from "../../../knip.config.base";
import type { KnipConfig } from "knip";

const { workspaces: _workspaces, ...base } = baseConfig;

export default {
	...base,
	ignore: [
		...(base.ignore ?? []),
		// PurgeCSS config loaded via CLI, not imported in source
		"purgecss.config.js",
	],
	ignoreDependencies: [
		...(base.ignoreDependencies ?? []),
		// Workspace dependencies — knip can't trace through esbuild-bundled entry points
		"browser-extension-core",
		"@packages/hutch-logger",
		// Used by scripts/check-unused-css.js (not a source-level import)
		"@packages/check-unused-css",
		// Used via scripts/run-tests-with-coverage.js (not a source import)
		"@packages/test-phase-runner",
	],
	ignoreBinaries: [
		...(base.ignoreBinaries ?? []),
		// Used via check script to delegate to Nx
		"nx",
	],
	entry: [
		// Extension entry points compiled by esbuild (scripts/build-extension.js)
		"src/runtime/background/background.browser.ts",
		"src/runtime/popup/popup.browser.ts",
		"src/runtime/content/shortcut.browser.ts",
	],
} satisfies KnipConfig;
