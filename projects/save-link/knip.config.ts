import baseConfig from "../../knip.config.base";
import type { KnipConfig } from "knip";

const { workspaces: _workspaces, ...base } = baseConfig;

export default {
	...base,
	entry: [
		"**/*.main.ts",
		"tools/*.mjs",
	],
	// Spread the base ignores rather than replacing them: the base already
	// declares `**/*.integration.ts` as an entry point, matching how the
	// integration phase in run-tests.config.js discovers them.
	ignore: [...(baseConfig.ignore || [])],
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
