import { decodeHtmlEntities } from "./decode-html-entities";

describe("decodeHtmlEntities", () => {
	it("decodes the entities a serialized href carries back to URL characters", () => {
		expect(decodeHtmlEntities("https://a.test/?x=1&amp;y=2")).toBe("https://a.test/?x=1&y=2");
		expect(decodeHtmlEntities("&lt;&gt;&quot;&#39;&amp;")).toBe("<>\"'&");
	});

	it("decodes a double-encoded sequence exactly one level", () => {
		expect(decodeHtmlEntities("&amp;lt;")).toBe("&lt;");
	});

	it("leaves a URL without entities unchanged", () => {
		expect(decodeHtmlEntities("https://a.test/path?x=1&y=2")).toBe("https://a.test/path?x=1&y=2");
	});
});
