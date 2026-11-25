import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { normalizeMalformedTitleEndTag, preserveQualifiedTitleHeading } from "./normalize-malformed-title-end-tag";
import { readabilityAdditions } from "./readability-additions";
import { initReadabilityParser } from "./readability-parser";

const url = "https://example.com/field-notes";
const code = "function example() {\n  return 7;\n}";
const paragraphs = [
	"The archive contains field notes describing the plants and soils found at the edge of the restored wetland during the spring survey.",
	"Further surveys will record changes in soil moisture and compare these observations with measurements taken at the same locations last autumn.",
];

function source(endTag: string): string {
	return `<!doctype html><html><head><script>const example = "</title/>";</script><title>Wetland Survey${endTag}
		</head><body><article>${paragraphs.map((text) => `<p>${text}</p>`).join("")}
		<pre><code>${code}</code></pre><p hidden>Independent hidden note.</p></article></body></html>`;
}

const { parseHtml } = initReadabilityParser({
	coverageRules: { inspect: () => [] },
	crawlArticle: async () => { throw new Error("Already fetched"); },
	siteRules: [],
	readabilityAdditions,
	logError: () => {},
});

describe("malformed head title end tag", () => {
	it("repairs only the active element's end token and is idempotent", () => {
		const repaired = normalizeMalformedTitleEndTag(source("</title/>"));

		expect(repaired).toBe(source("</title>"));
		expect(normalizeMalformedTitleEndTag(repaired)).toBe(repaired);
	});

	it("keeps the source title, visible paragraphs and code through the normal parser", () => {
		const result = parseHtml({ url, documentUrl: url, html: source("</title/>"), thumbnailUrl: null });

		assert(result.ok);
		const { document } = parseHTML(result.article.content);
		expect(result.article.title).toBe("Wetland Survey");
		expect(Array.from(document.querySelectorAll("p"), (p) => p.textContent)).toEqual(paragraphs);
		expect(document.querySelector("pre code")?.textContent).toBe(code);
	});

	it("retains the more specific body heading at its original level after repairing the short title", () => {
		const html = source("</title/>").replace("<article>", '<section id="main_content"><h2 id="survey">Wetland Survey appendix</h2>').replace("</article>", "</section>");
		const result = parseHtml({ url, documentUrl: url, html, thumbnailUrl: null });
		assert(result.ok);
		const { document } = parseHTML(result.article.content);
		expect(result.article.title).toBe("Wetland Survey");
		expect([...document.querySelectorAll("h2,h3")].map((h) => [h.localName, h.textContent])).toEqual([["h2", "Wetland Survey appendix"]]);
	});

	it("leaves ordinary correctly closed title deduplication alone", () => {
		const longTitle = "Detailed Wetland Survey Notes for the Spring Season";
		const html = source("</title>").replace("<article>", '<section id="main_content"><h2 id="survey">Wetland Survey III</h2>')
			.replace("</article>", "</section>").replaceAll("Wetland Survey", longTitle);
		const result = parseHtml({ url, documentUrl: url, html, thumbnailUrl: null });
		assert(result.ok);
		const { document } = parseHTML(result.article.content);
		expect(result.article.title).toBe(longTitle);
		expect([...document.querySelectorAll("h2,h3")].map((h) => h.textContent)).toEqual([]);
	});

	it("does not reinsert a qualified heading when its node was discarded downstream", () => {
		const { document } = parseHTML(source("</title>").replace("<article>", '<section id="main_content"><h2 id="survey">Wetland Survey III</h2>')
			.replace("</article>", "</section>"));
		const restore = preserveQualifiedTitleHeading(document);
		const otherArticle = "<div><h3>A separate report</h3><p>Another reading.</p></div>";
		expect(restore(otherArticle)).toBe(otherArticle);
	});

	it("preserves emphasis and inline code while keeping independently hidden qualified headings out", () => {
		const html = source("</title/>").replace("<article>", '<section id="main_content"><h2 id="survey" hidden>Wetland Survey appendix</h2>').replace("</article>", "</section>").replace("field notes", "<em>field</em> <code>notes</code>");
		const result = parseHtml({ url, documentUrl: url, html, thumbnailUrl: null });
		assert(result.ok);
		const { document } = parseHTML(result.article.content);
		expect([...document.querySelectorAll("h2,h3")].map((h) => h.textContent)).toEqual([]);
		expect([...document.querySelectorAll("p em, p code")].map((el) => [el.localName, el.textContent])).toEqual([["em", "field"], ["code", "notes"]]);
	});

	it.each([
		["ordinary title and hidden content", "<html><head><title>Field notes</title></head><body><p hidden>Notes</p></body></html>"],
		["comment", "<!-- <title>Example</title/> --><html><head><title>Field notes</title></head></html>"],
		["escaped element in body text", "<html><body><p>&lt;title&gt;Example&lt;/title/&gt;</p></body></html>"],
		["raw body example", "<html><body><textarea>Example </title/></textarea></body></html>"],
		["attribute value", "<html><body><span data-example='</title/>'>Example</span></body></html>"],
		["script literal", "<html><head><script>const end = '</title/>';</script><title>Field notes</title></head></html>"],
		["SVG title", "<html><body><svg><title>Example</title/></svg></body></html>"],
		["inert template title", "<html><head><template><title>Example</title/></template><title>Field notes</title></head></html>"],
	])("preserves %s byte for byte", (_label, html) => {
		expect(normalizeMalformedTitleEndTag(html)).toBe(html);
	});
});
