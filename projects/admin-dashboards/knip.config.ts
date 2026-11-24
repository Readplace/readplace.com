import baseConfig from "../../knip.config.base";
import type { KnipConfig } from "knip";

export default {
	...baseConfig,
	entry: ["src/runtime/*.main.ts"],
	ignore: [...(baseConfig.ignore || []), "purgecss.config.js"],
	ignoreDependencies: ["@pulumi/aws"],
	ignoreBinaries: [...(baseConfig.ignoreBinaries || []), "pulumi"],
	jest: {
		entry: ["src/**/*.test.ts"],
	},
	playwright: {
		config: ["playwright.config.local-dev.ts"],
		entry: ["src/e2e/**/*.e2e-local.ts"],
	},
} satisfies KnipConfig;
