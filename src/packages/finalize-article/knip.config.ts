import type { KnipConfig } from "knip";

export default {
	ignoreDependencies: [
		// knip doesn't resolve workspace subpath for @packages/* imports
		// (consistent with the workaround in @packages/web-test-harness)
		"@packages/article-parser",
		"@packages/article-resource-unique-id",
		"@packages/crawl-article",
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
