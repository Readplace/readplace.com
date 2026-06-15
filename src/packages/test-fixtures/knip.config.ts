import type { KnipConfig } from "knip";

export default {
	entry: [
		"src/index.ts",
		"src/fixture.ts",
		"src/providers/**/index.ts",
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
