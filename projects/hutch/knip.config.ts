import baseConfig from "../../knip.config.base";
import type { KnipConfig } from "knip";

// Strip `workspaces` from the base config because knip is invoked from inside
// this project's directory; the workspaces map is for monorepo-rooted runs.
const { workspaces: _workspaces, ...base } = baseConfig;

export default {
	...base,
	entry: [
		// Lambda entry points referenced by Pulumi infra (HutchLambda's `entryPoint`)
		// — knip can't follow those references, so list the convention here.
		"src/runtime/*.main.ts",
		// Client-side scripts loaded via HTML script tags (inherited from the
		// monorepo workspaces config — re-listed since we strip `workspaces`).
		"**/*.client.js",
		// Perf harness entry points (run via node, not playwright).
		"src/e2e/**/*.perf-local.main.ts",
	],
	ignore: [
		...(baseConfig.ignore || []),
		// PurgeCSS config loaded via CLI, not imported in source
		"purgecss.config.js",
	],
	ignoreDependencies: [
		// Used via CLI in dev script
		"livereload",
	],
	ignoreBinaries: [
		...(baseConfig.ignoreBinaries || []),
		// Used via deploy script, installed globally or via npx
		"pulumi",
	],
	// Jest runs pre-compiled JS from dist/ but test sources are in src/
	jest: {
		entry: ["src/**/*.test.ts"],
	},
	playwright: {
		config: ["playwright.config.local-dev.ts"],
		entry: ["src/e2e/**/*.e2e-local.ts", "src/e2e/e2e-server.main.ts"],
	},
} satisfies KnipConfig;
