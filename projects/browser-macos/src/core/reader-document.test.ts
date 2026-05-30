import assert from "node:assert/strict";
import {
	buildReaderDocument,
	buildStartDocument,
	estimateReadMinutes,
} from "./reader-document";

describe("estimateReadMinutes", () => {
	it("never returns less than one minute and rounds up", () => {
		assert.equal(estimateReadMinutes(0), 1);
		assert.equal(estimateReadMinutes(200), 1);
		assert.equal(estimateReadMinutes(201), 2);
	});
});

describe("buildReaderDocument", () => {
	it("renders title, site name, read time, content and a CSP", () => {
		const html = buildReaderDocument({
			article: {
				title: "My <Article>",
				siteName: "Test Blog",
				content: "<p>Body</p>",
				wordCount: 400,
			},
			url: "https://example.com/post",
			css: "body{color:red}",
		});
		assert.ok(html.includes("Content-Security-Policy"));
		assert.ok(html.includes("My &lt;Article&gt;"));
		assert.ok(html.includes("Test Blog · 2 min read"));
		assert.ok(html.includes("<p>Body</p>"));
		assert.ok(html.includes("body{color:red}"));
		assert.ok(html.includes("example.com"));
	});

	it("falls back to the hostname when metadata is missing", () => {
		const html = buildReaderDocument({
			article: { title: "  ", siteName: "  ", content: "", wordCount: 0 },
			url: "not a url",
			css: "",
		});
		assert.ok(html.includes("Article from not a url"));
		assert.ok(!html.includes("min read"));
	});
});

describe("buildStartDocument", () => {
	it("renders the welcome page with the injected stylesheet", () => {
		const html = buildStartDocument("body{}");
		assert.ok(html.includes("Where reading still matters."));
		assert.ok(html.includes("body{}"));
	});
});
