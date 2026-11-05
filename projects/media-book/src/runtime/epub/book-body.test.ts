import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { buildBookBody } from "./book-body";
import { chapterXhtml } from "./build-test-epub";

function elementsOf(html: string): string[] {
	const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
	return [...document.body.children].map((element) => element.outerHTML);
}

describe("buildBookBody", () => {
	it("emits a table of contents linking each chapter's section heading", () => {
		const body = buildBookBody([
			{ path: "OEBPS/one.xhtml", title: "One", xhtml: chapterXhtml("<p>a</p>") },
			{ path: "OEBPS/two.xhtml", title: "Two & more", xhtml: chapterXhtml("<p>b</p>") },
		]);

		const { document } = parseHTML(`<!doctype html><html><body>${body.html}</body></html>`);
		const links = [...document.querySelectorAll("ol > li > a")].map((a) => [a.getAttribute("href"), a.textContent]);
		assert.deepEqual(links, [["#section-ch-1", "One"], ["#section-ch-2", "Two & more"]]);
		assert.deepEqual([...document.querySelectorAll("h2")].map((h) => h.id), ["section-ch-1", "section-ch-2"]);
		assert.equal(body.sectionCount, 2);
	});

	it("drops images, inline svg and pictures between two paragraphs", () => {
		const body = buildBookBody([
			{
				path: "OEBPS/one.xhtml",
				title: "Opening",
				xhtml: chapterXhtml(`<p>First</p><img src="a.png"/><svg><image href="b.png"/></svg><picture><source srcset="c.png"/></picture><script>x()</script><p>Second</p>`),
			},
		]);

		assert.deepEqual(elementsOf(body.html).slice(1), ['<h2 id="section-ch-1">Opening</h2>', "<p>First</p>", "<p>Second</p>"]);
	});

	it("rewrites links between chapters to the target chapter's section", () => {
		const body = buildBookBody([
			{ path: "OEBPS/text/one.xhtml", title: "One", xhtml: chapterXhtml(`<p><a href="two.xhtml#note">next</a> <a href="#here">here</a> <a href="https://example.com/">out</a> <a href="missing.xhtml">gone</a></p>`) },
			{ path: "OEBPS/text/two.xhtml", title: "Two", xhtml: chapterXhtml("<p>b</p>") },
		]);

		const { document } = parseHTML(`<!doctype html><html><body>${body.html}</body></html>`);
		assert.deepEqual([...document.querySelectorAll("p a")].map((a) => a.getAttribute("href")), ["#section-ch-2", "#section-ch-1", "https://example.com/", null]);
	});

	it("counts the words of every chapter and excerpts the opening text", () => {
		const body = buildBookBody([
			{ path: "a.xhtml", title: "A", xhtml: chapterXhtml("<p>one two</p>") },
			{ path: "b.xhtml", title: "B", xhtml: chapterXhtml("<p>three</p>") },
		]);

		assert.equal(body.wordCount, 3);
		assert.equal(body.excerpt, "one two three");
	});

	it("counts no words for chapters without text", () => {
		assert.equal(buildBookBody([{ path: "a.xhtml", title: "A", xhtml: chapterXhtml("") }]).wordCount, 0);
	});
});
