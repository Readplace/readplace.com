import type { KnipConfig } from "knip";

export default {
	entry: ["src/index.ts"],
	ignoreBinaries: ["knip", "biome"],
	jest: {
		entry: ["src/**/*.test.ts"],
	},
} satisfies KnipConfig;
