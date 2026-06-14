import type { KnipConfig } from "knip";

export default {
	entry: [],
	ignore: [
		// PurgeCSS config loaded via CLI, not imported in source
		"purgecss.config.js",
	],
	ignoreBinaries: [
		"knip",
		"biome",
		// Used via check script to delegate to Nx
		"nx",
	],
} satisfies KnipConfig;
