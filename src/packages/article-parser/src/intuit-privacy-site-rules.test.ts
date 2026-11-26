import assert from "node:assert/strict";
import { sanitizeArticleHtml } from "@packages/domain/article";
import { parseHTML } from "linkedom";
import { initArticleSiteRules } from "./article-site-rules";
import { intuitPrivacySiteRules } from "./intuit-privacy-site-rules";
import { readabilityAdditions } from "./readability-additions";
import { initReadabilityParser } from "./readability-parser";

const DOCUMENT = "https://www.intuit.com/privacy/statement/";
const TITLE = "Synthetic public privacy statement";
const DATE = "Last Updated: May 3, 2026";
const LABELS = Array.from({ length: 12 }, (_, index) => `Policy section ${index + 1}`);
const FOOTER = Array.from({ length: 94 }, (_, index) => `footnote${index + 1}`).join(" ");
const LISTS = "<ul><li>first<ul><li>second<ol><li>third<ul><li>fourth<ol><li>fifth</li><li>sixth</li></ol></li></ul></li></ol></li></ul></li></ul>";
const FADE = "transition:opacity 417ms ease 0ms;-webkit-transition:opacity 417ms ease 0ms;opacity:0";
const HERO = `<picture data-testid="image">
	<source media="(max-width:767px)" srcSet="../media/hero-mobile.jpg" />
	<source media="(max-width:1023px)" srcSet="../media/hero.jpg" />
	<img src="../media/hero.jpg" alt="A door in the privacy illustration" width="312" height="467" loading="lazy" data-analytics="discard">
</picture>`;
const SEAL = '<p><a href="https://certification.example/verify" target="_blank" rel="noopener noreferrer"><img src="https://certification.example/seal.svg" alt="Certification seal"></a></p>';
const HIDDEN_DESCENDANTS = `
	<div hidden><p>Hidden marker one</p></div>
	<div inert><p>Hidden marker two</p></div>
	<div aria-hidden="TRUE"><p>Hidden marker three</p></div>
	<div style="display: none !important"><p>Hidden marker four</p></div>
	<div style="opacity: 0"><p>Hidden marker five</p></div>
	<div data-private><p>Hidden marker six</p></div>
	<div data-edit-only><p>Hidden marker seven</p></div>
	<div contenteditable><p>Hidden marker eight</p></div>
	<div role="region"><p>Hidden marker nine</p></div>
	<details><summary>Hidden marker ten</summary><p>Hidden marker eleven</p></details>
	<div data-testid="animHeight" class="rah-static rah-static--height-zero" aria-hidden="true" style="height:0;overflow:hidden"><p>Hidden marker twelve</p></div>
	<form action="../private"><p>Hidden marker thirteen</p></form>
	<template><p>Hidden marker fourteen</p></template>
	<!-- Comment marker -->
`;

function policyPage(extra = "") {
	let paragraph = 0;
	const sections = LABELS.map((label, index) => {
		const blocks = Array.from({ length: index < 7 ? 27 : 26 }, () => {
			paragraph++;
			const text = `Example provision ${paragraph}. A resident can review a request with the privacy office before delivering a written notice.`;
			const link = paragraph <= 116 ? ` <a href="../resources/provision-${paragraph}">Guidance ${paragraph}</a>` : "";
			return `<p>${text}${link}</p>`;
		}).join("");
		const list = index === 2 ? LISTS : "";
		return `<div><div data-testid="accordionItem">
			<button data-testid="accItemButton" aria-expanded="false" id="button-${index}" aria-controls="region-${index}"><span>${label}</span><svg><title>Decoration</title></svg></button>
			<div id="region-${index}" role="region" aria-labelledby="button-${index}">
				<div data-testid="animHeight" class="rah-static rah-static--height-zero" aria-hidden="true" style="height:0;overflow:hidden">
					<div style="${FADE}"><div class="AccordionItem_content__test">${blocks}${list}${index === 0 ? extra : ""}</div></div>
				</div>
			</div>
		</div></div>`;
	});
	const group = (items: string[]) => `<div><div data-testid="accordion"><div data-testid="accordion-buttons">
		<button data-testid="button-expand">Expand All</button>
		<button data-testid="button-collapse">Collapse All</button>
	</div>${items.join("")}</div></div>`;
	return `<!doctype html><html><head><title>${TITLE}</title><link rel="canonical" href="${DOCUMENT}"></head>
		<body data-theme="icom"><div class="publisher-shell"><div id="main" role="main">
			<div><section id="h01-primary-hero"><div><h1>${TITLE}</h1><p>Global privacy statements</p></div>${HERO}</section></div>
			<div><div data-testid="Container"><h2>General terms</h2><p>${DATE}</p><p>Read the following common provisions.</p>${SEAL}</div></div>
			${group(sections.slice(0, 7))}
			<div><div data-testid="Container"><h3>Regional terms</h3><p>Read the provisions for your region.</p></div></div>
			${group(sections.slice(7))}
		</div></div><div><article class="entry-content" id="article-body"><p>${FOOTER}</p></article></div></body></html>`;
}

const noIo = () => { throw new Error("The policy parser only reads supplied HTML"); };
const { siteRules } = initArticleSiteRules({ crawlFetch: noIo, logError: noIo });
const stock = initReadabilityParser({
	coverageRules: { inspect: () => [] },
	crawlArticle: noIo, logError: noIo, readabilityAdditions,
	siteRules: siteRules.filter((rule) => rule !== intuitPrivacySiteRules),
});
const parser = initReadabilityParser({ coverageRules: { inspect: () => [] }, crawlArticle: noIo, logError: noIo, readabilityAdditions, siteRules });

function parseInput(html = policyPage(), documentUrl = DOCUMENT) {
	return { html, url: "https://redirect.example/saved-policy", documentUrl, thumbnailUrl: null, fetchedDocument: true as const };
}

function readerContents(content: string): Element {
	return parseHTML(`<html><body>${sanitizeArticleHtml(content)}</body></html>`).document.body;
}

function labelText(element: Element): string {
	return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

describe("public privacy statement disclosures", () => {
	it("projects all public sections in source order through the parser and reader sanitizer", () => {
		const input = parseInput(policyPage(HIDDEN_DESCENDANTS));
		const baseline = stock.parseHtml(input);
		assert(baseline.ok);
		expect(baseline.article.wordCount).toBe(94);
		expect(labelText(readerContents(baseline.article.content))).toBe(FOOTER);

		const result = parser.parseHtml({ ...input, documentUrl: `${DOCUMENT}?view=example` });
		assert(result.ok);
		const reader = readerContents(result.article.content);
		expect(result.article.title).toBe(TITLE);
		expect(reader.textContent).toContain(DATE);
		expect(reader.textContent).toContain("Read the provisions for your region.");
		expect(reader.textContent).not.toMatch(/Hidden marker|Comment marker|Expand All|Collapse All|Decoration|footnote1/);
		expect([...reader.querySelectorAll("h2")].map(labelText)).toEqual(["General terms", ...LABELS]);
		const source = parseHTML(policyPage()).document;
		const authored = [...source.querySelectorAll('[role="region"] p, [role="region"] li:not(:has(li))')];
		expect(authored).toHaveLength(321);
		expect([...reader.querySelectorAll("p, li:not(:has(li))")].filter((element) => labelText(element).startsWith("Example provision") || element.matches("li")).map(labelText)).toEqual(authored.map(labelText));
		const links = [...reader.querySelectorAll("a[href]")].filter((link) => !link.querySelector("img"));
		expect(links).toHaveLength(116);
		expect(links.map((link) => [labelText(link), link.getAttribute("href")])).toEqual(
			Array.from({ length: 116 }, (_, index) => [`Guidance ${index + 1}`, `https://www.intuit.com/privacy/resources/provision-${index + 1}`]),
		);
		expect(reader.querySelector("ul")?.outerHTML).toBe(LISTS);
		expect(reader.querySelectorAll("ul, ol")).toHaveLength(5);
	});

	it("keeps the editorial picture sources and the image-labelled certification action in their source positions", () => {
		const input = parseInput();
		const result = parser.parseHtml(input);
		assert(result.ok);
		const { content } = result.article;
		const parsed = parseHTML(content).document;
		const picture = parsed.querySelector("picture");
		expect([...picture?.querySelectorAll("source") ?? []].map((source) => [
			source.getAttribute("media"),
			source.getAttribute("srcset"),
		])).toEqual([
			["(max-width:767px)", "https://www.intuit.com/privacy/media/hero-mobile.jpg"],
			["(max-width:1023px)", "https://www.intuit.com/privacy/media/hero.jpg"],
		]);
		const visible = [...readerContents(content).querySelectorAll("img, h2, a[href]")].slice(0, 5);
		expect(visible.map((item) => [item.localName, labelText(item) || item.getAttribute("alt")])).toEqual([
			["img", "A door in the privacy illustration"], ["h2", "General terms"],
			["a", null], ["img", "Certification seal"], ["h2", LABELS[0]],
		]);
		const [illustration, , action, seal] = visible;
		expect(illustration.getAttribute("src")).toBe("https://www.intuit.com/privacy/media/hero.jpg");
		expect(illustration.getAttribute("data-analytics")).toBeNull();
		expect(action.getAttribute("href")).toBe("https://certification.example/verify");
		expect(action.getAttribute("target")).toBe("_blank");
		expect(action.getAttribute("rel")).toBe("noopener noreferrer");
		expect(seal.parentElement).toBe(action);
	});

	it("preserves the certification label as link text when its source image URL is missing", () => {
		const html = policyPage().replace('src="https://certification.example/seal.svg" ', "");
		const result = parser.parseHtml(parseInput(html));
		assert(result.ok);
		const action = readerContents(result.article.content).querySelector('a[href="https://certification.example/verify"]');
		expect(action?.textContent).toBe("Certification seal");
		expect(action?.querySelector("img")).toBeNull();
	});

	it.each([true, false])("uses an observed HTTP terminal URL through parseArticle (%s)", async (hasTerminal) => {
		const input = parseInput();
		const { parseArticle } = initReadabilityParser({
			coverageRules: { inspect: () => [] },
			crawlArticle: async () => ({ status: "fetched", html: input.html, bodyHash: "synthetic", finalUrl: hasTerminal ? DOCUMENT : undefined }),
			logError: noIo,
			readabilityAdditions,
			siteRules,
		});
		const result = await parseArticle(DOCUMENT);
		assert(result.ok);
		expect(result.article.content.includes(LABELS[11])).toBe(hasTerminal);
	});

	it("leaves a submitted capture with the exact same URL and HTML on the stock parser", () => {
		const { fetchedDocument: _fetchedDocument, ...input } = parseInput();
		expect(parser.parseHtml(input)).toEqual(stock.parseHtml(input));
		expect(parser.parseHtml({ ...input, url: DOCUMENT })).toEqual(stock.parseHtml({ ...input, url: DOCUMENT }));
	});

	it.each([
		"https://other-publisher.example/privacy/statement/",
		"https://www.intuit.com/account/privacy/",
		"http://www.intuit.com/privacy/statement/",
		"https://visitor@www.intuit.com/privacy/statement/",
		"https://:secret@www.intuit.com/privacy/statement/",
		"https://www.intuit.com:8443/privacy/statement/",
	])("uses the stock parser for an out-of-scope fetch URL (%s)", (documentUrl) => {
		const input = parseInput(policyPage(), documentUrl);
		expect(parser.parseHtml(input)).toEqual(stock.parseHtml(input));
	});

	it.each([
		['rel="canonical"', 'rel="other"'],
		['rel="canonical"', 'rel="canonical" href="https://other-publisher.example/" data-other'],
		["</head>", `<link rel="canonical" href="${DOCUMENT}"></head>`],
		['id="main"', 'id="other"'],
		['id="main"', 'id="main" inert'],
		["</body>", '<div id="main"></div></body>'],
		['data-theme="icom"', 'data-theme="other"'],
		['id="h01-primary-hero"', 'id="not-a-hero"'],
		["</section>", "<h1>Duplicate heading</h1></section>"],
		["<h1>", "<h1 hidden>"],
		[`<p>${DATE}</p>`, `<p hidden>${DATE}</p>`],
		[`<p>${DATE}</p>`, `<p>${DATE}</p><p>${DATE}</p>`],
		[`<h1>${TITLE}</h1>`, "<h1> </h1>"],
		[`<p>${DATE}</p>`, "<p></p>"],
		['data-testid="Container"', 'data-testid="accordion"'],
		['data-testid="accordion"', 'data-testid="Container"'],
		['data-testid="Container"><h3>Regional terms</h3>', 'data-testid="accordion"><h3>Regional terms</h3>'],
		['data-testid="accordion"><div', 'data-testid="accordion" hidden><div'],
		['data-testid="button-expand"', 'data-testid="unknown"'],
		['data-testid="button-expand"', 'data-testid="button-expand" aria-disabled="true"'],
		['data-testid="button-expand"', 'data-testid="button-expand" hidden'],
		["Expand All", "Open privately"],
		['data-testid="accordionItem"', 'data-testid="unknown"'],
		['aria-expanded="false"', 'aria-expanded="true"'],
		['aria-expanded="false"', 'aria-expanded="false" disabled'],
		['aria-expanded="false"', 'aria-expanded="false" style="visibility:hidden"'],
		['id="region-0"', 'id="region-0" data-private'],
		['id="button-0"', 'id=""'],
		['id="region-0"', 'id=""'],
		['id="region-0"', 'id="region 0"'],
		['aria-labelledby="button-0"', 'aria-labelledby="button-1"'],
		['aria-labelledby="button-11"', 'aria-labelledby="button-10"'],
		['role="region" aria-labelledby="button-0">', 'role="region" aria-labelledby="button-0"></div><div hidden>'],
		['aria-controls="region-0"', 'aria-controls="region-1"'],
		["</body>", '<div id="button-0"></div></body>'],
		["</body>", '<div id="region-0"></div></body>'],
		["</body>", '<button aria-controls="other region-0"></button></body>'],
		['role="region" aria-labelledby', 'role="dialog" aria-labelledby'],
		['data-testid="animHeight"', 'data-testid="not-an-animation"'],
		['data-testid="animHeight"', 'data-testid="animHeight" hidden'],
		['style="height:0;overflow:hidden"', 'style="height:0;overflow:hidden;display:none"'],
		['aria-labelledby="button-0">', 'aria-labelledby="button-0"><div hidden></div>'],
		[`style="${FADE}"`, `style="${FADE}" hidden`],
		[`style="${FADE}"`, "style=\"opacity:0\""],
		['style="height:0;overflow:hidden">', 'style="height:0;overflow:hidden"><div hidden></div>'],
		['class="AccordionItem_content__test"', 'class="AccordionItem_content__test" aria-hidden="true"'],
		['class="AccordionItem_content__test"', 'class="content-for-editors"'],
		[`<span>${LABELS[0]}</span>`, "<span></span>"],
		[`<span>${LABELS[1]}</span>`, `<span>${LABELS[0]}</span>`],
	])("falls back as a whole when the public source is ambiguous (%s)", (before, after) => {
		const html = policyPage().replace(before, after);
		expect(html).not.toBe(policyPage());
		const input = parseInput(html);
		expect(parser.parseHtml(input)).toEqual(stock.parseHtml(input));
	});

	it("falls back when one complete-looking disclosure contains no authored text", () => {
		const { document } = parseHTML(policyPage());
		const body = document.querySelector(".AccordionItem_content__test");
		assert(body);
		body.innerHTML = '<p hidden>Hidden content</p><a>No visible provision</a>';
		const input = parseInput(document.toString());
		expect(parser.parseHtml(input)).toEqual(stock.parseHtml(input));
	});
});
