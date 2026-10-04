import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { demoteBodyHeadings } from "./demote-body-headings";
import { readabilityAdditions } from "./readability-additions";
import { initReadabilityParser } from "./readability-parser";

function runTransform(bodyHtml: string): { before: string; after: string } {
	const { document } = parseHTML(
		`<!DOCTYPE html><html><head></head><body>${bodyHtml}</body></html>`,
	);
	const before = document.body.innerHTML;
	demoteBodyHeadings(document);
	return { before, after: document.body.innerHTML };
}

describe("demoteBodyHeadings", () => {
	it("demotes a heading that holds block markup next to its own text", () => {
		const { after } = runTransform(
			'<div id="articleText"><h1><div class="ad"></div>The whole article body sits in this heading.</h1></div>',
		);

		expect(after).toBe(
			'<div id="articleText"><div><div class="ad"></div>The whole article body sits in this heading.</div></div>',
		);
	});

	it.each(["h1", "h2", "h3", "h4", "h5", "h6"])("demotes a body-bearing <%s>", (tag) => {
		const { after } = runTransform(`<${tag} class="x"><div></div>Body text.</${tag}>`);

		expect(after).toBe('<div class="x"><div></div>Body text.</div>');
	});

	it.each([
		["a plain heading", "<h1>Title</h1>"],
		["a heading with inline formatting", '<h2><a href="/a">Linked <em>title</em></a> <span>- 28/10/2008</span></h2>'],
		["a heading whose text is wrapped in a block", "<h2><div>Title</div></h2>"],
		["a heading holding only block markup and whitespace", "<h3> <div><img src=\"a.png\"></div> </h3>"],
		["an empty heading", "<h2></h2>"],
		["a heading with an anchor-link icon before its text", '<h2 id="one"><a href="#one"><svg><path d="M1 1"></path></svg></a>First section</h2>'],
		["a heading with an anchor-link icon after its text", '<h2>Second section<a href="#two"><span><svg></svg></span></a></h2>'],
		["a heading with a button beside its text", "<h1>Title<button>Share</button></h1>"],
		["a heading with ruby annotations", "<h2>漢<ruby>字<rt>じ</rt></ruby>の見出し</h2>"],
		["a heading with a picture beside its text", '<h3><picture><source srcset="a.webp"><img src="a.png"></picture>Caption</h3>'],
	])("leaves %s untouched", (_label, html) => {
		const { before, after } = runTransform(html);

		expect(after).toBe(before);
	});
});

describe("demoteBodyHeadings end-to-end through parseHtml", () => {
	const { parseHtml } = initReadabilityParser({
		crawlArticle: async () => ({
			status: "fetched" as const,
			html: "",
			bodyHash: "a".repeat(64),
		}),
		siteRules: [],
		readabilityAdditions,
		logError: () => {},
	});

	it("extracts an article whose body is wrapped in an <h1>, not the related-stories box beside it", () => {
		const url = "http://www.onscreenasia.com/article-106-aviddigitalworkflowbringskingkongtolife-onscreenasia.html";

		const result = parseHtml({
			url,
			documentUrl: url,
			html: readFileSync(join(__dirname, "fixtures", "body-inside-heading.html"), "utf-8"),
			thumbnailUrl: null,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.article.content).toContain("utilised an all-digital production environment for the movie");
	});
});
