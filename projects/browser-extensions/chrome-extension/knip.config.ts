import baseConfig from "../../../knip.config.base";
import type { KnipConfig } from "knip";

const { workspaces: _workspaces, ...base } = baseConfig;

export default {
	...base,
	ignore: [
		...(base.ignore ?? []),
		// CLI scripts (not entry points)
		"scripts/install-chrome-for-testing.js",
		"scripts/submit-to-chrome-web-store.js",
		// PurgeCSS config loaded via CLI, not imported in source
		"purgecss.config.js",
	],
	ignoreDependencies: [
		// Used by Pulumi infra (compiled separately)
		"@pulumi/pulumi",
		// Workspace dependency — knip can't trace through esbuild-bundled entry points
		"@packages/onboarding-extension-signal",
		"@packages/supported-clients",
	],
	ignoreBinaries: [
		...(base.ignoreBinaries ?? []),
		// Used via check script to delegate to Nx
		"nx",
		// Used via check-infra script
		"pulumi",
	],
	entry: [
		// Extension entry points compiled by esbuild
		"src/runtime/background/background.browser.ts",
		"src/runtime/popup/popup.browser.ts",
		"src/runtime/content/shortcut.browser.ts",
		// E2E test entry points (run via node --test)
		"src/e2e/**/run.e2e-local.main.ts",
		"src/e2e/**/run.e2e-staging.main.ts",
		"src/e2e/**/run.perf-local.main.ts",
	],
	playwright: {
		config: ["playwright.config.local-dev.ts"],
		entry: ["src/e2e/**/*-visual.e2e-local.ts"],
	},
} satisfies KnipConfig;
