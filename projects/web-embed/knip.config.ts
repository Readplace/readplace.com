import baseConfig from "../../knip.config.base";
import type { KnipConfig } from "knip";

export default {
	...baseConfig,
	entry: [
		// Standalone composition root booted by the playwright webServer and the
		// (future) production deployment — knip can't follow those references.
		"src/runtime/*.main.ts",
	],
	ignore: [...(baseConfig.ignore || []), "purgecss.config.js"],
	ignoreDependencies: [
		// Required by Pulumi to resolve the AWS provider at deploy time, but not
		// imported directly
		"@pulumi/aws",
	],
	ignoreBinaries: [
		...(baseConfig.ignoreBinaries || []),
		// Used via the deploy / check-infra scripts, installed globally or via npx
		"pulumi",
	],
	jest: {
		entry: ["src/**/*.test.ts"],
	},
	playwright: {
		config: ["playwright.config.local-dev.ts"],
		entry: ["src/e2e/**/*.e2e-local.ts"],
	},
} satisfies KnipConfig;
