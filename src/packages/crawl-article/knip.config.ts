import type { KnipConfig } from "knip";

export default {
	entry: [
		// Library entry point published via package.json. Listed explicitly
		// because knip's package.json detection doesn't back-resolve the
		// compiled output to the TypeScript source.
		"src/index.ts",
		// Real-network canary invoked by the nx `tier-1-plus-pipeline-health` target
		// and the tier-1-plus-crawl-pipeline-health workflow.
		"scripts/tier-1-plus-pipeline-health.ts",
		"scripts/health-sources.ts",
		// Credential canary invoked by the nx `health-egress-proxy` target, which
		// save-link's post-deploy runs.
		"scripts/health-egress-proxy.ts",
	],
	ignoreBinaries: [
		"knip",
		"biome",
		"nx",
	],
	jest: {
		entry: ["src/**/*.test.ts"],
	},
} satisfies KnipConfig;
