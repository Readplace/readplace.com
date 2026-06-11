import type { KnipConfig } from "knip";

export default {
	ignoreDependencies: [
		// knip doesn't resolve workspace subpath for @packages/* imports
		// (consistent with the workaround in @packages/domain)
		"@packages/article-parser",
		"@packages/article-resource-unique-id",
		"@packages/domain",
	],
	ignoreBinaries: [
		"knip",
		"biome",
	],
} satisfies KnipConfig;
