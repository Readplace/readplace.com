import assert from "node:assert/strict";
import {
	AI_ASSISTANT_SAVE_KEYWORDS,
	AI_ASSISTANTS_LISTED,
	AI_ASSISTANTS_OR,
	BROWSER_EXTENSION_KEYWORDS,
	BROWSER_EXTENSIONS_AND,
	BROWSER_EXTENSIONS_LISTED,
	BROWSER_EXTENSIONS_OR,
	NATIVE_APP_DEVICES_OR,
	orPhrase,
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

	it("joins advertised assistant names for prose", () => {
		assert.equal(AI_ASSISTANTS_LISTED, "ChatGPT, Gemini, Claude");
		assert.equal(AI_ASSISTANTS_OR, "ChatGPT, Gemini, or Claude");
		assert.equal(AI_ASSISTANT_SAVE_KEYWORDS, "save from ChatGPT, save from Gemini, save from Claude");
	});

	it("names a lone client without a joiner", () => {
		assert.equal(orPhrase(["Claude"]), "Claude");
	});

	it("names each advertised phone app as a device the visitor might own", () => {
		assert.equal(NATIVE_APP_DEVICES_OR, "an iPhone");
	});
});
