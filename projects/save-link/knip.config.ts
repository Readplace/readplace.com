import baseConfig from "../../knip.config.base";
import type { KnipConfig } from "knip";

const { workspaces: _workspaces, ...base } = baseConfig;

export default {
	...base,
	entry: [
		"**/*.main.ts",
		"tools/*.mjs",
	],
	ignore: [],
	ignoreBinaries: [
		// knip + nx are used in package.json scripts
		"knip",
		"nx",
		// Used via deploy script, installed globally or via npx
		"pulumi",
	],
	jest: {
		entry: ["src/**/*.test.ts"],
	},
} satisfies KnipConfig;
