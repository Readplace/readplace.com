import type { KnipConfig } from "knip";

export default {
	entry: [
		"src/index.ts",
		"src/fixture.ts",
		"src/providers/**/index.ts",
	],
	ignoreDependencies: [
		// Declared workspace dependency with no source import — without this
		// knip reports @packages/hutch-infra-components as an unused dependency.
		"@packages/hutch-infra-components",
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
