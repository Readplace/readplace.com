import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(__dirname, "..", "..", "..", "..");
const config = JSON.parse(
	readFileSync(join(repoRoot, "biome.config.base.json"), "utf8"),
);

describe("biome @aws-sdk ban override guard", () => {
	it("re-declares every base @aws-sdk ban in the override, because a Biome override replaces (not merges) rule options", () => {
		const basePaths =
			config.linter.rules.style.noRestrictedImports.options.paths;
		const overridePaths =
			config.overrides[0].linter.rules.style.noRestrictedImports.options.paths;

		const baseAwsSdkBans = Object.entries(basePaths).filter(([key]) =>
			key.startsWith("@aws-sdk"),
		);

		assert.ok(
			baseAwsSdkBans.length > 0,
			"Expected at least one @aws-sdk ban in the base noRestrictedImports paths — has the ban list moved?",
		);

		for (const [key, message] of baseAwsSdkBans) {
			assert.deepEqual(
				overridePaths[key],
				message,
				`@aws-sdk ban "${key}" is in the base noRestrictedImports paths but missing or out of sync in overrides[0]. ` +
					`A Biome override replaces (does not merge) the rule's options, so any @aws-sdk import ban not also ` +
					`re-declared in overrides[0].paths silently stops applying to **/*.test.ts and the auth-boundary files matched ` +
					`by that override. Copy the ban verbatim into overrides[0] in biome.config.base.json.`,
			);
		}
	});
});
