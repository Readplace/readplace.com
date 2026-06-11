import type { KnipConfig } from "knip";

export default {
	ignoreDependencies: [
		// knip doesn't resolve workspace subpath for @packages/* imports
		// (consistent with the workaround in @packages/test-fixtures)
		"@packages/article-parser",
		"@packages/crawl-article",
		"@packages/domain",
		"@packages/extract-links-from-page",
		"@packages/hutch-infra-components",
		"@packages/hutch-logger",
		"@packages/provider-contracts",
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
