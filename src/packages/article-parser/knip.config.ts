import type { KnipConfig } from "knip";

export default {
	ignoreDependencies: [
		"c8",
		"@packages/crawl-article",
	],
	ignoreBinaries: [
		"knip",
		"biome",
	],
	jest: {
		entry: ["src/**/*.test.ts"],
	},
} satisfies KnipConfig;
