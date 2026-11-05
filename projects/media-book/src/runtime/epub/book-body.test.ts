import assert from "node:assert/strict";
import { sanitizeArticleHtml } from "@packages/domain/article";
import { parseHTML } from "linkedom";
import { buildBookBody as buildBody, type ResolveImage } from "./book-body";
import { chapterXhtml } from "./build-test-epub";

const noImages: ResolveImage = async () => undefined;

function buildBookBody(chapters: Parameters<typeof buildBody>[0]["chapters"]) {
	return buildBody({ chapters, resolveImage: noImages });
}

function resolvingTo(sources: Record<string, string>) {
	const asked: string[] = [];
	const resolveImage: ResolveImage = async (zipPath) => {
		asked.push(zipPath);
		return sources[zipPath];
	};
	return { asked, resolveImage };
}

function elementsOf(html: string): string[] {
	const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
	return [...document.body.children].map((element) => element.outerHTML);
}

describe("buildBookBody", () => {
	it("emits a table of contents linking each chapter's section heading", async () => {
		const body = await buildBookBody([
			{ path: "OEBPS/one.xhtml", title: "One", xhtml: chapterXhtml("<p>a</p>") },
			{ path: "OEBPS/two.xhtml", title: "Two & more", xhtml: chapterXhtml("<p>b</p>") },
		]);

		const { document } = parseHTML(`<!doctype html><html><body>${body.html}</body></html>`);
		const links = [...document.querySelectorAll("ol > li > a")].map((a) => [a.getAttribute("href"), a.textContent]);
		assert.deepEqual(links, [["#section-ch-1", "One"], ["#section-ch-2", "Two & more"]]);
		assert.deepEqual([...document.querySelectorAll("h2")].map((h) => h.id), ["section-ch-1", "section-ch-2"]);
		assert.equal(body.sectionCount, 2);
	});

	it("drops an image the resolver does not keep, an svg without an image, and scripts, keeping the text around them", async () => {
		const body = await buildBookBody([
			{
				path: "OEBPS/one.xhtml",
				title: "Opening",
				xhtml: chapterXhtml(`<p>First</p><img src="a.png"/><svg><circle r="1"/></svg><svg><image/></svg><picture><source srcset="c.png"/></picture><script>x()</script><p>Second</p>`),
			},
		]);

		assert.deepEqual(elementsOf(body.html).slice(1), ['<h2 id="section-ch-1">Opening</h2>', "<p>First</p>", "<picture></picture>", "<p>Second</p>"]);
	});

	it("resolves each distinct image once against its chapter's document and lazy-loads it", async () => {
		const { asked, resolveImage } = resolvingTo({ "OEBPS/images/a.png": "/queue/r/media/a.png", "OEBPS/b.png": "/queue/r/media/b.png" });

		const body = await buildBody({
			chapters: [
				{ path: "OEBPS/text/ch1.xhtml", title: "One", xhtml: chapterXhtml(`<p>x</p><img src="../images/a.png" srcset="../images/a2.png 2x" alt="A"/><img src="../images/a.png#frag"/>`) },
				{ path: "OEBPS/text/ch2.xhtml", title: "Two", xhtml: chapterXhtml(`<p>y</p><img src="../images/a.png"/><img src="../b.png"/>`) },
			],
			resolveImage,
		});

		assert.deepEqual(asked, ["OEBPS/images/a.png", "OEBPS/b.png"]);
		const { document } = parseHTML(`<!doctype html><html><body>${body.html}</body></html>`);
		assert.deepEqual(
			[...document.querySelectorAll("img")].map((img) => [img.getAttribute("src"), img.getAttribute("loading"), img.getAttribute("srcset")]),
			[
				["/queue/r/media/a.png", "lazy", null],
				["/queue/r/media/a.png", "lazy", null],
				["/queue/r/media/a.png", "lazy", null],
				["/queue/r/media/b.png", "lazy", null],
			],
		);
	});

	it.each([
		["href", `<svg><image href="cover.jpg"/></svg>`],
		["xlink:href", `<svg xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="cover.jpg"/></svg>`],
	])("turns an svg that wraps an image's %s into a resolved img", async (_, markup) => {
		const { asked, resolveImage } = resolvingTo({ "OEBPS/cover.jpg": "/queue/r/media/cover.jpg" });

		const body = await buildBody({ chapters: [{ path: "OEBPS/cover.xhtml", title: "Cover", xhtml: chapterXhtml(markup) }], resolveImage });

		assert.deepEqual(asked, ["OEBPS/cover.jpg"]);
		assert.deepEqual(elementsOf(body.html).slice(2), ['<img loading="lazy" src="/queue/r/media/cover.jpg">']);
	});

	it("gives a picture's img its resolved src", async () => {
		const { resolveImage } = resolvingTo({ "OEBPS/c.png": "/queue/r/media/c.png" });

		const body = await buildBody({ chapters: [{ path: "OEBPS/one.xhtml", title: "One", xhtml: chapterXhtml(`<picture><source srcset="c2.png"/><img src="c.png"/></picture>`) }], resolveImage });

		assert.deepEqual(elementsOf(body.html).slice(2), ['<picture><img loading="lazy" src="/queue/r/media/c.png"></picture>']);
	});

	it.each([
		["a data url", `<img src="data:image/png;base64,AAAA"/>`],
		["an absolute url", `<img src="https://example.com/a.png"/>`],
		["a protocol-relative url", `<img src="//example.com/a.png"/>`],
		["a root-relative path", `<img src="/a.png"/>`],
		["no src", `<img alt="x"/>`],
	])("drops an img with %s without asking the resolver", async (_, markup) => {
		const { asked, resolveImage } = resolvingTo({});

		const body = await buildBody({ chapters: [{ path: "OEBPS/one.xhtml", title: "One", xhtml: chapterXhtml(`<p>a</p>${markup}<p>b</p>`) }], resolveImage });

		assert.deepEqual(asked, []);
		assert.deepEqual(elementsOf(body.html).slice(2), ["<p>a</p>", "<p>b</p>"]);
	});

	it("keeps resolved plain, svg-wrapped and picture images through the article sanitiser", async () => {
		const { resolveImage } = resolvingTo({ "OEBPS/a.png": "/queue/r/media/a.png", "OEBPS/b.png": "/queue/r/media/b.png", "OEBPS/c.png": "/queue/r/media/c.png" });

		const body = await buildBody({
			chapters: [{ path: "OEBPS/one.xhtml", title: "One", xhtml: chapterXhtml(`<img src="a.png"/><svg><image href="b.png"/></svg><picture><source srcset="x.png"/><img src="c.png"/></picture>`) }],
			resolveImage,
		});

		const { document } = parseHTML(`<!doctype html><html><body>${sanitizeArticleHtml(body.html)}</body></html>`);
		assert.deepEqual(
			[...document.querySelectorAll('img[src^="/queue/"][loading="lazy"]')].map((img) => img.getAttribute("src")),
			["/queue/r/media/a.png", "/queue/r/media/b.png", "/queue/r/media/c.png"],
		);
	});

	it("rewrites links between chapters to the target chapter's section", async () => {
		const body = await buildBookBody([
			{ path: "OEBPS/text/one.xhtml", title: "One", xhtml: chapterXhtml(`<p><a href="two.xhtml#note">next</a> <a href="#here">here</a> <a href="https://example.com/">out</a> <a href="missing.xhtml">gone</a></p>`) },
			{ path: "OEBPS/text/two.xhtml", title: "Two", xhtml: chapterXhtml("<p>b</p>") },
		]);

		const { document } = parseHTML(`<!doctype html><html><body>${body.html}</body></html>`);
		assert.deepEqual([...document.querySelectorAll("p a")].map((a) => a.getAttribute("href")), ["#section-ch-2", "#section-ch-1", "https://example.com/", null]);
	});

	it("counts the words of every chapter and excerpts the opening text", async () => {
		const body = await buildBookBody([
			{ path: "a.xhtml", title: "A", xhtml: chapterXhtml("<p>one two</p>") },
			{ path: "b.xhtml", title: "B", xhtml: chapterXhtml("<p>three</p>") },
		]);

		assert.equal(body.wordCount, 3);
		assert.equal(body.excerpt, "one two three");
	});

	it("counts no words for chapters without text", async () => {
		assert.equal((await buildBookBody([{ path: "a.xhtml", title: "A", xhtml: chapterXhtml("") }])).wordCount, 0);
	});
});
