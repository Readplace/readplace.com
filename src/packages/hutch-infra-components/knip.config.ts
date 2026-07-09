import type { KnipConfig } from "knip";

export default {
	ignoreDependencies: [
		// Type definitions for Lambda handler signatures
		"@types/aws-lambda",
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
