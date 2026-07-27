import type { KnipConfig } from "knip";

export default {
	entry: ["e2e-cdn-fixtures/**/*.client.js"],
	ignoreBinaries: ["knip", "biome", "nx"],
	jest: {
		entry: ["src/**/*.test.ts"],
	},
} satisfies KnipConfig;
