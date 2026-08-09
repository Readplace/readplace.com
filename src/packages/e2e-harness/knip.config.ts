import type { KnipConfig } from "knip";

export default {
	ignoreBinaries: ["knip", "biome", "nx"],
	jest: {
		entry: ["src/**/*.test.ts"],
	},
} satisfies KnipConfig;
