import type { KnipConfig } from "knip";

export default {
	entry: [
		"scripts/check-stuck-articles.ts",
		"scripts/classify-row.ts",
		"scripts/collect-stuck-rows.ts",
	],
	ignoreBinaries: ["knip", "biome", "nx"],
} satisfies KnipConfig;
