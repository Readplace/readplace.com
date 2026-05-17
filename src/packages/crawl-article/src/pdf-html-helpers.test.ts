import assert from "node:assert/strict";
import { deriveTitleFromUrl, escapeHtmlText } from "./pdf-html-helpers";

describe("deriveTitleFromUrl", () => {
	it("returns the slugged last path segment with .pdf extension stripped", () => {
		assert.equal(deriveTitleFromUrl("https://example.com/files/airmanship_good.pdf"), "airmanship good");
	});

	it("handles snake_case and kebab-case in the same segment", () => {
		assert.equal(deriveTitleFromUrl("https://example.com/file-name_part.pdf"), "file name part");
	});

	it("returns 'Untitled PDF' when the URL has no path segments", () => {
		assert.equal(deriveTitleFromUrl("https://example.com/"), "Untitled PDF");
	});

	it("returns 'Untitled PDF' when the URL cannot be parsed", () => {
		assert.equal(deriveTitleFromUrl("::not a url::"), "Untitled PDF");
	});

	it("strips the .pdf extension case-insensitively", () => {
		assert.equal(deriveTitleFromUrl("https://example.com/Sample.PDF"), "Sample");
	});
});

describe("escapeHtmlText", () => {
	it("escapes HTML-significant characters", () => {
		assert.equal(escapeHtmlText('"Risky" & <Funky>'), "&quot;Risky&quot; &amp; &lt;Funky&gt;");
	});
});
