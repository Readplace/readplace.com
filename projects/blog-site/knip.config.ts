import baseConfig from "../../knip.config.base";
import type { KnipConfig } from "knip";

// Strip `workspaces` from the base config because knip is invoked from inside
// this project's directory; the workspaces map is for monorepo-rooted runs.
const { workspaces: _workspaces, ...base } = baseConfig;

export default {
	...base,
	entry: [
		// Lambda + local server entry points referenced by Pulumi infra / start
		// script — knip can't follow those references, so list the convention here.
		"src/runtime/*.main.ts",
	],
	ignoreDependencies: [
		...(baseConfig.ignoreDependencies || []),
		// knip doesn't resolve workspace subpath for @packages/* imports
		"@packages/web-shell",
		// Used in src/infra (reached via the Pulumi entry point, which knip ignores)
		"@packages/hutch-infra-components",
		"@pulumi/aws",
		"@pulumi/pulumi",
	],
	ignoreBinaries: [
		...(baseConfig.ignoreBinaries || []),
		// Used via deploy script, installed globally or via npx
		"pulumi",
	],
	jest: {
		entry: ["src/**/*.test.ts"],
	},
} satisfies KnipConfig;
