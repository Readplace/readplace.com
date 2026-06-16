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
		"src/*.main.ts",
	],
	ignore: [...(baseConfig.ignore || [])],
	ignoreBinaries: [...(baseConfig.ignoreBinaries || [])],
	jest: {
		entry: ["src/**/*.test.ts"],
	},
	playwright: {
		config: ["playwright.config.local-dev.ts"],
		entry: ["src/e2e/**/*.e2e-local.ts"],
	},
} satisfies KnipConfig;
