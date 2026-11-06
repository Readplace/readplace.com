import assert from "node:assert/strict";
import { DEFAULT_LOCALE, isSupportedLocale, SUPPORTED_LOCALES } from "./locale";

describe("locale", () => {
	it("serves en-US by default", () => {
		assert.equal(DEFAULT_LOCALE, "en-US");
		assert.ok(SUPPORTED_LOCALES.includes(DEFAULT_LOCALE));
	});

	it("recognises only the supported locales", () => {
		assert.equal(isSupportedLocale("en-US"), true);
		assert.equal(isSupportedLocale("en-AU"), false);
		assert.equal(isSupportedLocale(undefined), false);
	});
});
