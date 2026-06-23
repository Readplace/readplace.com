import type { KnipConfig } from "knip";

export default {
	// Library entry point — published as `main`/`types` in package.json
	// (dist/index.js). Listed explicitly because knip's package.json detection
	// doesn't back-resolve dist/index.js to src/index.ts.
	entry: ["src/index.ts"],
	ignoreBinaries: ["knip", "biome", "nx"],
	jest: {
		entry: ["src/**/*.test.ts"],
	},
} satisfies KnipConfig;
