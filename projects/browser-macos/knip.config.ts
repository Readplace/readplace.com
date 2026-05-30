import type { KnipConfig } from "knip";
import baseConfig from "../../knip.config.base";

// Strip `workspaces` from the base config because knip is invoked from inside
// this project's directory; the workspaces map is for monorepo-rooted runs.
const { workspaces: _workspaces, ...base } = baseConfig;

export default {
	...base,
	entry: [
		// Electron entry points reached by the runtime, not by a source import:
		// the main process (package.json `main`) and the preload (loaded by
		// absolute path from BrowserWindow's `webPreferences.preload`).
		"src/shell/*.main.ts",
		// Renderer script loaded via a <script> tag in index.html.
		"**/*.client.js",
		// Build scripts invoked from package.json scripts.
		"scripts/**/*.{js,mjs}",
	],
	ignoreDependencies: [
		...(baseConfig.ignoreDependencies || []),
		// knip doesn't resolve the workspace subpath for @packages/* imports when
		// run from inside the project directory (see projects/hutch/knip.config.ts).
		// Both are imported as values in src/core/reader-pipeline.ts.
		"@packages/article-parser",
		"@packages/crawl-article",
	],
	jest: {
		entry: ["src/**/*.test.ts"],
	},
} satisfies KnipConfig;
