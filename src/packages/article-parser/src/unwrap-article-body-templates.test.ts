import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { readabilityAdditions } from "./readability-additions";
import { initReadabilityParser } from "./readability-parser";
import { unwrapArticleBodyTemplates } from "./unwrap-article-body-templates";

describe("unwrapArticleBodyTemplates", () => {
	it("replaces a text/template script inside the article body with the markup it holds", () => {
		const { document } = parseHTML(
			"<html><body><div class='post-content' itemprop='articleBody'><script type='text/template'><p>First <b>post</b> paragraph</p><p>Second</p></script></div></body></html>",
		);

		unwrapArticleBodyTemplates(document);

		expect(document.body.innerHTML).toBe(
			'<div class="post-content" itemprop="articleBody"><p>First <b>post</b> paragraph</p><p>Second</p></div>',
		);
	});

	it("leaves a text/template script outside the article body as it was", () => {
		const source =
			"<html><body><script type='text/template'><p>Widget markup</p></script><div itemprop='articleBody'><p>Post</p></div></body></html>";
		const { document } = parseHTML(source);
		const before = document.toString();

		unwrapArticleBodyTemplates(document);

		expect(document.toString()).toBe(before);
	});

	it("leaves an ordinary script inside the article body as it was", () => {
		const source = "<html><body><div itemprop='articleBody'><script>var a = '<p>x</p>';</script><p>Post</p></div></body></html>";
		const { document } = parseHTML(source);
		const before = document.toString();

		unwrapArticleBodyTemplates(document);

		expect(document.toString()).toBe(before);
	});

	describe("through Readability", () => {
		const paragraph = "The security team describes how the new memory-safe component reduces vulnerabilities across the platform. ";
		const url = "https://blog.example.test/2026/11/memory-safety.html";
		const parser = initReadabilityParser({
			crawlArticle: async () => ({ status: "failed", decision: undefined }),
			siteRules: [],
			readabilityAdditions,
			logError: () => {},
		});

		it("recovers a Blogger post served inside a text/template script under the article body", () => {
			const html = `<!DOCTYPE html><html><head><title>Memory safety</title></head><body><header><h1>Example Security Blog</h1><p>The latest news and insights</p></header><div class='post'><h3 class='post-title'>Memory safety</h3><div class='post-body'><div class='post-content' itemprop='articleBody'><script type='text/template'><p>${paragraph.repeat(10)}</p><p>${paragraph.repeat(10)}</p></script></div></div></div></body></html>`;

			const result = parser.parseHtml({ url, documentUrl: url, html, thumbnailUrl: null });

			assert(result.ok, "the post parses");
			expect(result.article.content).toContain(paragraph.trim());
			expect(result.article.wordCount).toBeGreaterThanOrEqual(280);
		});

		it("parses a page without the template structure as before", () => {
			const html = `<!DOCTYPE html><html><head><title>Plain post</title></head><body><article><p>${paragraph.repeat(10)}</p></article></body></html>`;
			const withoutUnwrap = initReadabilityParser({
				crawlArticle: async () => ({ status: "failed", decision: undefined }),
				siteRules: [],
				readabilityAdditions: { ...readabilityAdditions, unwrapArticleBodyTemplates: () => {} },
				logError: () => {},
			});

			const result = parser.parseHtml({ url, documentUrl: url, html, thumbnailUrl: null });

			expect(result).toEqual(withoutUnwrap.parseHtml({ url, documentUrl: url, html, thumbnailUrl: null }));
		});
	});
});
