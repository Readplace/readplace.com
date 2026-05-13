import type { KnipConfig } from "knip";

export default {
	ignoreDependencies: [
		// knip doesn't resolve workspace subpath for @packages/* imports
		// (consistent with the workaround in @packages/domain)
		"@packages/article-resource-unique-id",
		"@packages/article-state-types",
		"@packages/domain",
		"@packages/hutch-storage-client",
	],
	ignoreBinaries: [
		"knip",
		"biome",
	],
	jest: {
		entry: ["src/**/*.test.ts"],
	},
} satisfies KnipConfig;
