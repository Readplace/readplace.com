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
	],
	ignore: [
		...(baseConfig.ignore || []),
		// PurgeCSS config loaded via CLI, not imported in source
		"purgecss.config.js",
	],
	ignoreDependencies: [
		...(baseConfig.ignoreDependencies || []),
		// Used via CLI in dev script
		"livereload",
		// Workspace dependencies with subpath imports not detected by knip
		"browser-extension-core",
		"save-link",
		// Used in app.ts (reached via infra entry point which knip ignores)
		"@packages/hutch-infra-components",
		"@packages/hutch-storage-client",
		// Used by scripts/check-unused-css.js (not a source-level import)
		"@packages/check-unused-css",
		// knip doesn't resolve workspace subpath for @packages/* imports
		"@packages/article-aggregate-store",
		"@packages/article-resource-unique-id",
		"@packages/article-state-types",
		"@packages/crawl-article",
		"@packages/domain",
		"@packages/onboarding-extension-signal",
		"@packages/test-fixtures",
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
