import type { KnipConfig } from "knip";

export default {
	ignoreDependencies: [
		"@packages/crawl-article",
		"@packages/domain",
	],
	ignoreBinaries: [
		"knip",
		"biome",
	],
	jest: {
		entry: ["src/**/*.test.ts"],
	},
} satisfies KnipConfig;
