import type { KnipConfig } from "knip";

export default {
	entry: [
		// Library entry point published as `main`/`types`. Listed explicitly
		// because knip's package.json detection doesn't back-resolve the built
		// output to the source entry.
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
