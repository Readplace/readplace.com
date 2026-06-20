import type { KnipConfig } from "knip";

export default {
	entry: [
		"scripts/check-failed-articles.ts",
		"scripts/collect-failed-rows.ts",
		"scripts/exclude-patterns.ts",
		"scripts/require-env.ts",
	],
	ignoreBinaries: ["knip", "biome"],
} satisfies KnipConfig;
