import type { KnipConfig } from "knip";

export default {
	entry: [
		"src/index.ts",
		"src/fixture.ts",
		"src/providers/**/index.ts",
	],
	ignoreDependencies: [
		"c8",
		// knip doesn't resolve workspace subpath for @packages/* imports
		// (consistent with the workaround in @packages/crawl-article)
		"@packages/article-parser",
		"@packages/article-resource-unique-id",
		"@packages/crawl-article",
		"@packages/domain",
		"@packages/extract-links-from-page",
		"@packages/hutch-infra-components",
		"@packages/hutch-logger",
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
