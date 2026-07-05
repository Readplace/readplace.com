import assert from "node:assert/strict";
import {
	BROWSER_EXTENSION_KEYWORDS,
	BROWSER_EXTENSIONS_AND,
	BROWSER_EXTENSIONS_LISTED,
	BROWSER_EXTENSIONS_OR,
} from "./client-enumerations";

describe("client enumerations", () => {
	it("joins browser-extension names for prose", () => {
		assert.equal(BROWSER_EXTENSIONS_AND, "Firefox and Chrome");
		assert.equal(BROWSER_EXTENSIONS_OR, "Firefox or Chrome");
		assert.equal(BROWSER_EXTENSIONS_LISTED, "Firefox, Chrome");
	});

	it("builds SEO keywords per extension", () => {
		assert.equal(BROWSER_EXTENSION_KEYWORDS, "Firefox extension, Chrome extension");
	});
});
