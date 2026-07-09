import type { KnipConfig } from "knip";

export default {
	entry: ["src/generators/*/generator.ts"],
	ignoreBinaries: ["knip", "biome", "nx"],
	jest: {
		entry: ["src/**/*.test.ts"],
	},
} satisfies KnipConfig;
