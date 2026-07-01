import type { KnipConfig } from "knip";

export default {
	entry: [
		// Listed explicitly because knip's package.json detection doesn't
		// back-resolve the built entry to its source entry.
		"src/index.ts",
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
