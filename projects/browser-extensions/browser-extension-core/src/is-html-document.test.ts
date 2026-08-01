import { isHtmlDocument } from "./is-html-document";

describe("isHtmlDocument", () => {
	it("detects an ordinary HTML page", () => {
		expect(isHtmlDocument({ contentType: "text/html" })).toBe(true);
	});

	it("detects an XHTML page", () => {
		expect(isHtmlDocument({ contentType: "application/xhtml+xml" })).toBe(true);
	});

	it("ignores charset parameters and casing the browser may report", () => {
		expect(isHtmlDocument({ contentType: "TEXT/HTML; charset=utf-8" })).toBe(true);
	});

	it("rejects a native PDF viewer tab", () => {
		expect(isHtmlDocument({ contentType: "application/pdf" })).toBe(false);
	});

	it("rejects a bare image tab, whose outerHTML is the browser's own viewer chrome", () => {
		expect(isHtmlDocument({ contentType: "image/jpeg" })).toBe(false);
	});

	it("rejects plain text", () => {
		expect(isHtmlDocument({ contentType: "text/plain" })).toBe(false);
	});
});
