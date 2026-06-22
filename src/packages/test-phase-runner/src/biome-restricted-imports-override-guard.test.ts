import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(__dirname, "..", "..", "..", "..");
const config = JSON.parse(
	readFileSync(join(repoRoot, "biome.config.base.json"), "utf8"),
);

const basePaths = config.linter.rules.style.noRestrictedImports.options.paths;
const overridePaths =
	config.overrides[0].linter.rules.style.noRestrictedImports.options.paths;

const baseOnlyBans = new Set(["@packages/domain/user"]);

describe("biome noRestrictedImports override guard", () => {
	it("mirrors every base import ban into the override, because a Biome override replaces (not merges) rule options", () => {
		const baseKeys = Object.keys(basePaths);

		assert.ok(
			baseKeys.length > 0,
			"Expected at least one ban in the base noRestrictedImports paths — has the ban list moved?",
		);

		for (const key of baseKeys) {
			if (baseOnlyBans.has(key)) continue;

			assert.deepEqual(
				overridePaths[key],
				basePaths[key],
				`Import ban "${key}" is declared in the base noRestrictedImports paths but is missing or out of sync in ` +
					`overrides[0]. A Biome override replaces (does not merge) the rule's options, so any ban not also ` +
					`re-declared in overrides[0].paths silently stops applying to **/*.test.ts and the auth-boundary files ` +
					`matched by that override. Copy the ban verbatim into overrides[0] in biome.config.base.json — or, if it ` +
					`must deliberately NOT apply to those files, add "${key}" to baseOnlyBans in this test.`,
			);
		}
	});

	it("keeps the base-only exception list honest — every withheld key still exists in the base", () => {
		for (const key of baseOnlyBans) {
			assert.ok(
				key in basePaths,
				`"${key}" is recorded as a base-only ban (deliberately withheld from overrides[0]) but no longer exists ` +
					`in the base noRestrictedImports paths. Remove it from baseOnlyBans in this test.`,
			);
		}
	});
});
