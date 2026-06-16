import baseConfig from "../../knip.config.base";
import type { KnipConfig } from "knip";

// Strip `workspaces` from the base config because knip is invoked from inside
// this project's directory; the workspaces map is for monorepo-rooted runs.
const { workspaces: _workspaces, ...base } = baseConfig;

export default {
	...base,
	entry: [
		// Standalone composition root booted by the playwright webServer and the
		// (future) production deployment — knip can't follow those references.
		"src/runtime/*.main.ts",
	],
	ignore: [...(baseConfig.ignore || [])],
	ignoreDependencies: [
		// Required by Pulumi to resolve the AWS provider at deploy time, but not
		// imported directly (HutchLambda in @packages/hutch-infra-components is)
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
