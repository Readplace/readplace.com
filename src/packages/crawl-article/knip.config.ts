import type { KnipConfig } from "knip";

export default {
	entry: [
		// Library entry point — published as `main`/`types` in package.json
		// (dist/src/index.js). Listed explicitly because knip's package.json
		// detection doesn't back-resolve dist/src/index.js to src/index.ts.
		"src/index.ts",
		// Real-network canary invoked by the nx `tier-1-plus-pipeline-health` target
		// and the tier-1-plus-crawl-pipeline-health workflow. Compiled to
		// dist/scripts/tier-1-plus-pipeline-health.js and run with `node --test`.
		// Requires the sources table (health-sources.ts) as a direct import.
		"scripts/tier-1-plus-pipeline-health.ts",
		"scripts/health-sources.ts",
	],
	ignoreDependencies: [
		// knip doesn't resolve workspace subpath for @packages/* imports
		// (consistent with the same workaround in projects/hutch and projects/save-link)
		"@packages/article-state-types",
		// HutchLogger is consumed only as a TypeScript type by init-mupdf-lazy.ts.
		// The import is erased at compile time, so knip's runtime-dependency
		// scan flags it as unused — but the type would dangle without it.
		"@packages/hutch-logger",
	],
	ignoreBinaries: [
		"knip",
		"biome",
	],
	jest: {
		entry: ["src/**/*.test.ts"],
	},
} satisfies KnipConfig;
