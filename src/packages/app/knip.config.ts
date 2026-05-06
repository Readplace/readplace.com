import type { KnipConfig } from "knip";

export default {
	entry: [
		// Bundled by esbuild via scripts/build-client-bundles.js — knip can't trace
		// these from source since the bundler reads them as side-effect entries.
		"src/web/**/*.client.ts",
	],
	ignoreDependencies: [
		// knip doesn't resolve workspace subpath for @packages/* imports
		// (consistent with the workaround in @packages/test-fixtures)
		"@packages/article-resource-unique-id",
		"@packages/article-state-types",
		"@packages/crawl-article",
		"@packages/domain",
		"@packages/hutch-infra-components",
		"@packages/hutch-logger",
		"@packages/onboarding-extension-signal",
		"@packages/test-fixtures",
		"browser-extension-core",
		// Subpath import (save-link/generate-summary) — knip can't resolve workspace subpaths
		"save-link",
		// Loaded via CLI (scripts/check-unused-css.js)
		"@packages/check-unused-css",
		// Loaded via CLI (scripts/run-tests-with-coverage.js)
		"@packages/test-phase-runner",
	],
	ignoreBinaries: [
		"knip",
		"nx",
	],
	jest: {
		entry: ["src/**/*.test.ts"],
	},
} satisfies KnipConfig;
