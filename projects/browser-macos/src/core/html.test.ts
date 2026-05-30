import assert from "node:assert/strict";
import { escapeHtml, hostnameOf } from "./html";

describe("escapeHtml", () => {
	it("escapes every HTML-significant character", () => {
		assert.equal(
			escapeHtml(`<a href="x">&'</a>`),
			"&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;",
		);
	});
});

describe("hostnameOf", () => {
	it("returns the hostname of a valid URL", () => {
		assert.equal(hostnameOf("https://sub.example.com/a?b=1"), "sub.example.com");
	});

	it("falls back to the raw string for non-URL input", () => {
		assert.equal(hostnameOf("not a url"), "not a url");
	});
});
