import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { mediaWikiSiteRules } from "./mediawiki-site-rules";
import { readabilityAdditions } from "./readability-additions";
import { initReadabilityParser } from "./readability-parser";
import { substackSiteRules } from "./substack-site-rules";

function anchorWidget(slug: string): string {
	return (
		'<div class="pencraft pc-display-flex pc-alignItems-center pc-position-absolute pc-reset header-anchor-parent">' +
		'<div class="pencraft pc-display-contents pc-reset pubTheme-yiXxQA">' +
		`<div class="pencraft pc-reset header-anchor offset-top" id="§${slug}"></div>` +
		`<button class="pencraft pc-reset iconButton-mq_Et5" tabindex="0" type="button" data-href="https://example.substack.com/i/1/${slug}">` +
		'<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" class="lucide lucide-link">' +
		'<path d="M10 13a5 5 0 0 0 7.54.54l3-3"></path></svg></button></div></div>'
	);
}

function runTransform(bodyHtml: string): { before: string; after: string } {
	const { document } = parseHTML(`<!DOCTYPE html><html><head></head><body>${bodyHtml}</body></html>`);
	const before = document.body.innerHTML;
	substackSiteRules.transform({ document });
	return { before, after: document.body.innerHTML };
}

describe("substackSiteRules.matches", () => {
	it("matches substack.com and custom domains alike, leaving detection to the heading markup", () => {
		expect(
			[
				{ url: "https://francisheylighen.substack.com/p/stigmergy", hostname: "francisheylighen.substack.com" },
				{ url: "https://www.astralcodexten.com/p/essay", hostname: "www.astralcodexten.com" },
			].map((params) => substackSiteRules.matches(params)),
		).toEqual([true, true]);
	});
});

describe("substackSiteRules.transform", () => {
	it("strips the empty anchor widget and the anchored class from an h2", () => {
		const { after } = runTransform(`<h2 class="header-anchor-post">The Mechanism${anchorWidget("the-mechanism")}</h2>`);

		expect(after).toBe("<h2>The Mechanism</h2>");
	});

	it("strips the same shape from an h3, keeping its level", () => {
		const { after } = runTransform(`<h3 class="header-anchor-post">Further reading${anchorWidget("further-reading")}</h3>`);

		expect(after).toBe("<h3>Further reading</h3>");
	});

	it("treats a widget holding only zero-width and word-joiner characters as empty", () => {
		const { after } = runTransform(
			'<h2 class="header-anchor-post">Method<div class="header-anchor-parent">\u200B \u2060\uFEFF</div></h2>',
		);

		expect(after).toBe("<h2>Method</h2>");
	});

	it("keeps a widget that carries visible text", () => {
		const { after } = runTransform(
			'<h2 class="header-anchor-post">Method<div class="header-anchor-parent"><span>Part 2</span></div></h2>',
		);

		expect(after).toBe('<h2>Method<div class="header-anchor-parent"><span>Part 2</span></div></h2>');
	});

	it("keeps the heading's other classes and a meaningful link inside it", () => {
		const { after } = runTransform(
			`<h2 class="intro header-anchor-post"><a href="https://example.com/source">Sources</a>${anchorWidget("sources")}</h2>`,
		);

		expect(after).toBe('<h2 class="intro"><a href="https://example.com/source">Sources</a></h2>');
	});

	it("leaves the anchored class on anything but an h2 or h3 untouched", () => {
		const bodyHtml =
			`<h4 class="header-anchor-post">Aside${anchorWidget("aside")}</h4>` +
			'<p class="header-anchor-post">Body paragraph.</p>' +
			`<div class="header-anchor-parent"></div>`;

		const { before, after } = runTransform(bodyHtml);

		expect(after).toBe(before);
	});

	it("leaves a page without Substack headings untouched", () => {
		const { before, after } = runTransform(
			'<header class="site-header"><h2 class="header">Site</h2></header><article><h2>Plain</h2><p>Body.</p></article>',
		);

		expect(after).toBe(before);
	});
});

const BODY_PARAGRAPH =
	"Termites build their mounds without a plan or a foreman: each one reacts to the traces " +
	"the others left in the mud, and the structure grows out of those traces alone. ".repeat(3);

function substackPost(input: { tag: "h2" | "h3"; titles: readonly string[] }): string {
	const sections = input.titles
		.map(
			(title) =>
				`<${input.tag} class="header-anchor-post">${title}${anchorWidget(title.toLowerCase())}</${input.tag}>` +
				`<p>${BODY_PARAGRAPH}</p><p>${BODY_PARAGRAPH}</p>`,
		)
		.join("");
	return (
		"<!DOCTYPE html><html><head><title>Stigmergy: the most important concept you've never heard of</title></head>" +
		'<body><div class="available-content"><div class="body markup" dir="auto">' +
		`<p>${BODY_PARAGRAPH}</p>${sections}` +
		"</div></div></body></html>"
	);
}

const CUSTOM_DOMAIN_POST_URL = "https://www.example-newsletter.com/p/stigmergy";

function parsedHeadings(input: {
	html: string;
	url: string;
	siteRules: Parameters<typeof initReadabilityParser>[0]["siteRules"];
}): {
	headings: string[];
	paragraphs: string[];
} {
	const { parseHtml } = initReadabilityParser({
		crawlArticle: async () => ({ status: "fetched" as const, html: "", bodyHash: "a".repeat(64) }),
		siteRules: input.siteRules,
		readabilityAdditions,
		logError: () => {},
	});
	const result = parseHtml({ url: input.url, documentUrl: input.url, html: input.html, thumbnailUrl: null });
	expect(result.ok).toBe(true);
	if (!result.ok) return { headings: [], paragraphs: [] };
	const { document } = parseHTML(`<html><body>${result.article.content}</body></html>`);
	return {
		headings: Array.from(document.querySelectorAll("h2, h3"), (heading) => `${heading.tagName} ${heading.textContent}`),
		paragraphs: Array.from(document.querySelectorAll("p"), (paragraph) => String(paragraph.textContent)),
	};
}

describe("substackSiteRules end-to-end through parseHtml", () => {
	const TITLES = ["The Mechanism", "Why It Works", "Further reading"];

	it.each(["h2", "h3"] as const)("keeps %s section headings on a custom-domain post, with no anchor chrome", (tag) => {
		const { headings } = parsedHeadings({
			html: substackPost({ tag, titles: TITLES }),
			url: CUSTOM_DOMAIN_POST_URL,
			siteRules: [substackSiteRules],
		});

		expect(headings).toEqual(TITLES.map((title) => `${tag.toUpperCase()} ${title}`));
	});

	it("loses the same headings when the rule is not registered", () => {
		const { headings } = parsedHeadings({
			html: substackPost({ tag: "h2", titles: TITLES }),
			url: CUSTOM_DOMAIN_POST_URL,
			siteRules: [],
		});

		expect(headings).toEqual([]);
	});

	it("leaves every paragraph exactly as the parser kept it without the rule", () => {
		const html = substackPost({ tag: "h2", titles: TITLES });

		const withRule = parsedHeadings({ html, url: CUSTOM_DOMAIN_POST_URL, siteRules: [substackSiteRules] });
		const withoutRule = parsedHeadings({ html, url: CUSTOM_DOMAIN_POST_URL, siteRules: [] });

		expect(withRule.paragraphs).toEqual(withoutRule.paragraphs);
	});

	it("keeps a MediaWiki article's headings with both rules registered", () => {
		const html =
			"<!DOCTYPE html><html><head><title>The Mythical Man-Month - Wikipedia</title></head>" +
			'<body><div id="content"><div class="mw-parser-output">' +
			`<p>${BODY_PARAGRAPH}</p>` +
			["Ideas presented", "Reception"]
				.map(
					(title, index) =>
						`<div class="mw-heading mw-heading2"><h2>${title}</h2><span class="mw-editsection">[<a href="/w/index.php?action=edit&amp;section=${index}">edit</a>]</span></div>` +
						`<p>${BODY_PARAGRAPH}</p><p>${BODY_PARAGRAPH}</p>`,
				)
				.join("") +
			"</div></div></body></html>";

		const { headings } = parsedHeadings({
			html,
			url: "https://en.wikipedia.org/wiki/The_Mythical_Man-Month",
			siteRules: [mediaWikiSiteRules, substackSiteRules],
		});

		expect(headings).toEqual(["H2 Ideas presented", "H2 Reception"]);
	});
});

describe("substackSiteRules on captured articles", () => {
	const STIGMERGY_URL = "https://francisheylighen.substack.com/p/stigmergy-the-most-important-concept";
	const stigmergyHtml = readFileSync(join(__dirname, "fixtures", "substack-stigmergy.html"), "utf-8");
	const STIGMERGY_RECOVERED_HEADINGS = [
		"H2 The Mechanism",
		"H2 Where the Idea Came From: Termites and Ants",
		"H2 The Coordination Problem We All Live With",
		"H2 What Is Stigmergy, in Plain Language?",
		"H2 Systems We Already Rely On (Without Noticing)",
		"H2 Why Stigmergy Works So Well",
		"H2 What Happens without Stigmergy",
		"H2 Why We’ve Missed the Concept",
		"H2 Why Stigmergy Matters Now",
		"H2 A Concept Whose Time Has Come",
		"H2 Further reading",
	];

	it("holds twelve anchored section headings in the captured source", () => {
		const { document } = parseHTML(stigmergyHtml);

		expect(
			Array.from(document.querySelectorAll("h2.header-anchor-post, h3.header-anchor-post"), (heading) =>
				`${heading.tagName} ${heading.textContent}`,
			),
		).toEqual(["H2 The Concept", ...STIGMERGY_RECOVERED_HEADINGS]);
	});

	it("recovers every Stigmergy section heading but The Concept, in document order", () => {
		const { headings } = parsedHeadings({ html: stigmergyHtml, url: STIGMERGY_URL, siteRules: [substackSiteRules] });

		expect(headings).toEqual(STIGMERGY_RECOVERED_HEADINGS);
	});

	it("loses every Stigmergy section heading when the rule is not registered", () => {
		const { headings } = parsedHeadings({ html: stigmergyHtml, url: STIGMERGY_URL, siteRules: [] });

		expect(headings).toEqual([]);
	});

	it("leaves every Stigmergy paragraph exactly as the parser kept it without the rule", () => {
		const withRule = parsedHeadings({ html: stigmergyHtml, url: STIGMERGY_URL, siteRules: [substackSiteRules] });
		const withoutRule = parsedHeadings({ html: stigmergyHtml, url: STIGMERGY_URL, siteRules: [] });

		expect(withRule.paragraphs).toEqual(withoutRule.paragraphs);
	});
});
