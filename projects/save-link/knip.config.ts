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
	ignoreDependencies: [
		...(base.ignoreDependencies ?? []),
		// Workspace dependencies with subpath imports not detected by knip
		"@packages/article-parser",
		"@packages/hutch-infra-components",
		"@packages/hutch-storage-client",
		"@packages/article-resource-unique-id",
		"@packages/article-state-types",
		"@packages/article-store",
		"@packages/crawl-article",
		"@packages/domain",
		"@packages/refresh-article-content",
		"@packages/retriable",
		"@packages/test-fixtures",
	],
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
