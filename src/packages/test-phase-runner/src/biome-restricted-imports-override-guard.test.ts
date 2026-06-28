import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const globs: string[] = [];
	for (const item of value) {
		if (typeof item !== "string") return undefined;
		globs.push(item);
	}
	return globs;
}

function sameIncludes(a: string[], b: string[]): boolean {
	if (a.length !== b.length) return false;
	const bGlobs = new Set(b);
	return a.every((glob) => bGlobs.has(glob));
}

function restrictedImportPaths(
	linter: unknown,
	where: string,
): Record<string, unknown> | undefined {
	if (!isRecord(linter)) return undefined;
	if (!isRecord(linter.rules)) return undefined;
	if (!isRecord(linter.rules.style)) return undefined;
	const rule = linter.rules.style.noRestrictedImports;
	if (rule === undefined) return undefined;

	const shapeMessage =
		`${where} declares style.noRestrictedImports but not in the expected ` +
		`{ level, options: { paths: { ... } } } shape, so this guard can no longer read ` +
		`its ban list to verify the base bans are mirrored. Restore that shape in ` +
		`biome.config.base.json.`;
	assert(isRecord(rule), shapeMessage);
	assert(isRecord(rule.options), shapeMessage);
	assert(isRecord(rule.options.paths), shapeMessage);
	return rule.options.paths;
}

const repoRoot = join(__dirname, "..", "..", "..", "..");
const config: unknown = JSON.parse(
	readFileSync(join(repoRoot, "biome.config.base.json"), "utf8"),
);

assert(isRecord(config), "biome.config.base.json did not parse to a JSON object.");

const basePaths = restrictedImportPaths(config.linter, "The base linter");
assert(
	basePaths,
	"The base linter in biome.config.base.json no longer declares " +
		"style.noRestrictedImports.options.paths. This guard mirrors those bans into every " +
		"override that re-declares the rule — restore the base bans or remove this guard.",
);

const overrides = config.overrides;
assert(
	Array.isArray(overrides),
	"biome.config.base.json has no `overrides` array, so this guard cannot verify the " +
		"base import bans are mirrored into them. Restore the overrides or remove this guard.",
);

const registeredOverrides = [
	{
		includes: [
			"**/*.test.ts",
			"**/providers/auth/dynamodb-auth.ts",
			"**/providers/oauth/validate-access-token.ts",
			"**/providers/auth/in-memory-auth.ts",
			"src/get-session-user-id.ts",
		],
		withheld: ["@packages/domain/user"],
	},
];

describe("biome noRestrictedImports override guard", () => {
	it("mirrors the base import bans into every override that re-declares the rule (exact mirror, minus each override's withheld set), because a Biome override replaces (not merges) rule options", () => {
		const baseKeys = Object.keys(basePaths);
		assert.ok(
			baseKeys.length > 0,
			"Expected at least one ban in the base noRestrictedImports paths — has the ban list moved?",
		);

		for (const [index, rawOverride] of overrides.entries()) {
			assert(
				isRecord(rawOverride),
				`overrides[${index}] in biome.config.base.json is not an object.`,
			);

			const overridePaths = restrictedImportPaths(
				rawOverride.linter,
				`overrides[${index}]`,
			);
			if (!overridePaths) continue;

			const includes = readStringArray(rawOverride.includes);
			assert(
				includes,
				`overrides[${index}] re-declares noRestrictedImports but has no string[] ` +
					`\`includes\`, so this guard cannot identify which override it is or what it withholds.`,
			);

			const registered = registeredOverrides.find((entry) =>
				sameIncludes(entry.includes, includes),
			);
			assert(
				registered,
				`An override matching ${JSON.stringify(includes)} re-declares noRestrictedImports ` +
					`but is not registered in this guard. A Biome override replaces (does not merge) the ` +
					`rule's options, so each base ban must be re-declared in the override or it silently ` +
					`stops applying to the files the override matches. Add an entry to registeredOverrides ` +
					`in this test with this override's \`includes\` and the base bans it deliberately ` +
					`withholds (use \`withheld: []\` if it mirrors all of them). If you only changed an ` +
					`existing override's \`includes\`, update that entry's \`includes\` to match.`,
			);

			for (const key of baseKeys) {
				if (registered.withheld.includes(key)) continue;
				assert.deepEqual(
					overridePaths[key],
					basePaths[key],
					`Import ban "${key}" is declared in the base noRestrictedImports paths but is ` +
						`missing or out of sync in the override matching ${JSON.stringify(includes)}. A Biome ` +
						`override replaces (does not merge) the rule's options, so any ban not re-declared in ` +
						`the override silently stops applying to the files it matches. Copy the ban verbatim ` +
						`into that override in biome.config.base.json — or, if it must deliberately NOT apply ` +
						`to those files, add "${key}" to that override's \`withheld\` list in registeredOverrides.`,
				);
			}

			for (const key of Object.keys(overridePaths)) {
				assert.ok(
					key in basePaths && !registered.withheld.includes(key),
					`Import ban "${key}" appears in the override matching ${JSON.stringify(includes)} but ` +
						`is not a mirrored base ban. The base and overrides are kept as exact mirrors (minus ` +
						`each override's withheld set): either "${key}" is absent from the base ` +
						`noRestrictedImports paths (add it to the base so it applies everywhere, or remove it ` +
						`from the override), or it is listed in this override's \`withheld\` (remove it from ` +
						`\`withheld\`, or remove the ban from the override).`,
				);
			}
		}
	});

	it("keeps the registered-override list honest — every registered override still exists in the config and re-declares the rule", () => {
		for (const registered of registeredOverrides) {
			const match = overrides.find((raw) => {
				if (!isRecord(raw)) return false;
				const includes = readStringArray(raw.includes);
				if (!includes || !sameIncludes(includes, registered.includes)) {
					return false;
				}
				return (
					restrictedImportPaths(raw.linter, "a registered override") !== undefined
				);
			});
			assert.ok(
				match,
				`registeredOverrides lists an override matching ${JSON.stringify(registered.includes)} ` +
					`that no longer exists in biome.config.base.json, or no longer re-declares ` +
					`noRestrictedImports. Remove the stale entry from registeredOverrides in this test, or ` +
					`restore the override in the config.`,
			);
		}
	});

	it("keeps each withheld ban honest — every withheld key still exists in the base", () => {
		for (const registered of registeredOverrides) {
			for (const key of registered.withheld) {
				assert.ok(
					key in basePaths,
					`registeredOverrides withholds "${key}" from the override matching ` +
						`${JSON.stringify(registered.includes)}, but that ban no longer exists in the base ` +
						`noRestrictedImports paths. Remove it from that override's \`withheld\` list.`,
				);
			}
		}
	});
});
