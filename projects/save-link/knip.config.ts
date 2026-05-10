import baseConfig from "../../knip.config.base";
import type { KnipConfig } from "knip";

const { workspaces: _workspaces, ...base } = baseConfig;

export default {
	...base,
	entry: [
		"**/*.main.ts",
	],
	ignore: [
		...(base.ignore ?? [])
	],
	ignoreDependencies: [
		...(base.ignoreDependencies ?? []),
		// Workspace dependencies with subpath imports not detected by knip
		"@packages/hutch-infra-components",
		"@packages/hutch-storage-client",
		"@packages/article-resource-unique-id",
		"@packages/article-state-types",
		"@packages/crawl-article",
		"@packages/test-fixtures",
		// Used only in infra code (Pulumi IaC, compiled separately)
		"@pulumi/aws",
	],
	ignoreBinaries: [
		...(base.ignoreBinaries ?? []),
		// Used via deploy script, installed globally or via npx
		"pulumi",
	],
	jest: {
		entry: ["src/**/*.test.ts"],
	},
} satisfies KnipConfig;
