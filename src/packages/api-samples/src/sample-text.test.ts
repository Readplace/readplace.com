import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SAMPLE_TEXT } from "./index";

const SAMPLE_FILES = [
	[SAMPLE_TEXT.typescript.discover, "typescript/discover.ts"],
	[SAMPLE_TEXT.typescript.saveArticle, "typescript/save-article.ts"],
	[SAMPLE_TEXT.swift.discover, "swift/Discover.swift"],
	[SAMPLE_TEXT.swift.saveArticle, "swift/SaveArticle.swift"],
];

describe("SAMPLE_TEXT", () => {
	it.each(SAMPLE_FILES)("matches the sample file %#", (text, file) => {
		assert.equal(text, readFileSync(resolve(__dirname, "../src/samples", file), "utf8"));
	});

	it.each(SAMPLE_FILES)("hard-codes no API path other than the entry point in sample %#", (text) => {
		assert.doesNotMatch(text, /"\/(queue|oauth|api)[^"]*"/);
	});
});
