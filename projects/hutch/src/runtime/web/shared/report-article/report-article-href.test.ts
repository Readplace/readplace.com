import assert from "node:assert/strict";
import { reportArticleHref } from "./report-article-href";

describe("reportArticleHref", () => {
	it("addresses the report inbox with the article's title and public view URL", () => {
		const href = new URL(
			reportArticleHref({ viewUrl: "https://readplace.com/view/example.com/post", title: "Q&A: cats?" }),
		);

		assert.equal(href.protocol, "mailto:");
		assert.equal(href.pathname, "readplace+report@readplace.com");
		assert.equal(href.searchParams.get("subject"), "Report: Q&A: cats?");
		assert.equal(
			href.searchParams.get("body"),
			"Article: https://readplace.com/view/example.com/post\n\nWhat is wrong with it?\n",
		);
	});
});
