import baseConfig from "../../../knip.config.base";
import type { KnipConfig } from "knip";

const { workspaces: _workspaces, ...base } = baseConfig;

export default {
	...base,
	ignore: [
		...(base.ignore ?? []),
		// CLI scripts (not entry points)
		"scripts/sync-signed-extension.js",
		"scripts/submit-to-amo.js",
		// PurgeCSS config loaded via CLI, not imported in source
		"purgecss.config.js",
	],
	ignoreDependencies: [
		// Workspace dependency — knip can't trace through esbuild-bundled entry points
		"@packages/onboarding-extension-signal",
		// Type-only dependency — needed for TypeScript inference of HutchS3PublicRead properties, not directly imported
		"@pulumi/aws",
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
	],
} satisfies KnipConfig;
