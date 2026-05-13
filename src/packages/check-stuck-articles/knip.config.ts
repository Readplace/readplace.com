import type { KnipConfig } from "knip";

export default {
	entry: [
		"scripts/check-stuck-articles.ts",
		"scripts/classify-row.ts",
		"scripts/collect-stuck-rows.ts",
	],
	ignoreDependencies: [
		// knip doesn't resolve workspace subpath for @packages/* imports
		// (consistent with the same workaround in projects/hutch and crawl-article)
		"@packages/article-state-types",
		"@packages/hutch-storage-client",
	],
	ignoreBinaries: ["knip", "biome"],
} satisfies KnipConfig;
