import assert from "node:assert/strict";
import { DEFAULT_LOCALE } from "@packages/translations";
import { collectTemplates, findCopyViolations, helperKeyOf } from "@packages/translations/copy-checker";
import { WEB_CATALOG } from "@packages/translations/web-catalog";

const MIGRATED_DIRECTORIES: readonly string[] = [];

const EXEMPT_TOKENS: readonly string[] = ["Readplace"];

describe("user-facing copy", () => {
	it("comes from the translation files in every migrated directory", async () => {
		const templates = await collectTemplates({ root: __dirname, directories: MIGRATED_DIRECTORIES });
		const violations = findCopyViolations({
			templates,
			findMessage: (key) => WEB_CATALOG.findMessage({ locale: DEFAULT_LOCALE, key }),
			keyOf: helperKeyOf,
			exemptTokens: EXEMPT_TOKENS,
		});
		assert.deepEqual(violations, []);
	});
});
