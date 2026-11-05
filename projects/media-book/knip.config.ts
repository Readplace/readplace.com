import baseConfig from "../../knip.config.base";
import type { KnipConfig } from "knip";

export default {
	...baseConfig,
	entry: ["src/runtime/*.main.ts"],
	ignoreBinaries: ["knip", "nx", "pulumi"],
	jest: {
		entry: ["src/**/*.test.ts"],
	},
} satisfies KnipConfig;
