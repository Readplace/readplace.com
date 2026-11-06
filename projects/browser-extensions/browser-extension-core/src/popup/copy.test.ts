import assert from "node:assert/strict";
import { lookupMessage } from "@packages/translations";
import { collectTemplates, findCopyViolations, pathKeyOf } from "@packages/translations/copy-checker";
import { browserExtension } from "@packages/translations/browser-extension";

const MIGRATED_DIRECTORIES: readonly string[] = [];

const EXEMPT_TOKENS: readonly string[] = ["Readplace"];

describe("user-facing copy", () => {
	it("comes from the translation files in every migrated directory", async () => {
		const templates = await collectTemplates({ root: __dirname, directories: MIGRATED_DIRECTORIES });
		const violations = findCopyViolations({
			templates,
			findMessage: (key) => {
				const message = lookupMessage(browserExtension.defaultMessages, key);
				return typeof message === "string" ? message : undefined;
			},
			keyOf: pathKeyOf,
			exemptTokens: EXEMPT_TOKENS,
		});
		assert.deepEqual(violations, []);
	});
});
