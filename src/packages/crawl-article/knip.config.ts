import type { KnipConfig } from "knip";

export default {
	entry: [
		// Library entry point published via package.json. Listed explicitly
		// because knip's package.json detection doesn't back-resolve the
		// compiled output to the TypeScript source.
		"src/index.ts",
		// Real-network canary invoked by the nx `tier-1-plus-pipeline-health` target
		// and the tier-1-plus-crawl-pipeline-health workflow. Compiled to
		// dist/scripts/tier-1-plus-pipeline-health.js and run with `node --test`.
		// Requires the sources table (health-sources.ts) as a direct import.
		"scripts/tier-1-plus-pipeline-health.ts",
		"scripts/health-sources.ts",
	],
	ignoreBinaries: [
		"knip",
		"biome",
	],
	jest: {
		entry: ["src/**/*.test.ts"],
	},
} satisfies KnipConfig;
