import { sanitizeArticleHtml } from "@packages/domain/article";
import { parseHTML } from "linkedom";
import { initArticleSiteRules } from "./article-site-rules";
import { readabilityAdditions } from "./readability-additions";
import { initReadabilityParser } from "./readability-parser";
import { preserveSubstackImagePreview } from "./substack-image-preview";

const POST = "https://journal.example/p/river-field-notes";
const IMAGES = ["bank-sketch.jpg", "water-gauge.jpg"].map((name) => {
	const original = `https://substack-post-media.s3.amazonaws.com/public/${name}`;
	return { original, src: `https://substackcdn.com/image/fetch/w_600/${encodeURIComponent(original)}` };
});
const imageSave = (image: string) => `https://journal.example/i/123456?img=${encodeURIComponent(image)}&utm_source=source`;
const DECK = "Notes from the spring survey";
const DECK_MARKUP = `<h3 class="subtitle">${DECK}</h3>`;
const DISCLOSURE = "This post is for paid subscribers";
const VISIBLE_PARAGRAPH = "During this morning's survey, our volunteers read the numbered gauge where it was fixed to the old bridge. " +
	"The record includes the time, the water depth, the observers' names, and the condition of the footpath after yesterday's rain. " +
	"The station will remain in service through the end of the season so that the town can compare the same observations each week.";
const HEADING = '<h1 class="header-anchor-post" id="method">Measuring the river<div class="header-anchor-parent"><button> </button></div></h1>';
const HTML = `<!doctype html><html><head><title>Field Notes From the River</title>
<link rel="canonical" href="${POST}"><meta property="og:url" content="${POST}">
<meta property="article:published_time" content="2025-11-18T12:00:00Z"></head><body>
<article class="newsletter-post post"><div class="post-header">
<h1 class="post-title published">Field Notes From the River</h1>
${DECK_MARKUP}
<div class="byline-wrapper"><a href="/@avery">Avery Chen</a><a href="/@other" hidden>Hidden byline</a></div></div>
<div><div class="dt-post-body"><div class="available-content"><div class="body markup">
<p>${VISIBLE_PARAGRAPH}</p>
<figure><a href="/bank-original"><img src="${IMAGES[0].src}" alt="Sketch of the bank" width="600" height="800"></a></figure>
${HEADING}
<p>In the next section of the survey, the volunteers worked from a <a href="/survey-guide">field instruction sheet</a>. ${VISIBLE_PARAGRAPH}</p>
<p hidden>Unavailable paragraph sentinel.</p>
<p style="display : none !important">Inline-hidden paragraph sentinel.</p>
<p aria-hidden="true">Accessibility-hidden paragraph sentinel.</p>
<div inert><p>Inert paragraph sentinel.</p></div>
<template><p>Template paragraph sentinel.</p></template>
<div itemprop="articleBody"><script type="text/template"><p>Unwrapped script paragraph sentinel.</p></script></div>
<video hidden src="/hidden-video.mp4"></video>
<figure><a href="/gauge-original"><img src="${IMAGES[1].src}" alt="Gauge on the bridge" width="640" height="480"></a></figure>
<p>We packed the measuring equipment after the last morning reading.</p>
</div></div></div>
<div class="paywall" data-testid="paywall"><h2 class="paywall-title">${DISCLOSURE}</h2><p>Subscribe</p></div>
<div hidden><p>Post-cutoff paragraph sentinel.</p></div>
<div><p>Unrelated sibling after the cutoff.</p></div></div></article>
</body></html>`;

function noIo(): never {
	throw new Error("Unexpected request");
}

const { parseHtml } = initReadabilityParser({
	crawlArticle: noIo,
	siteRules: initArticleSiteRules({ crawlFetch: noIo, logError: noIo }).siteRules,
	readabilityAdditions,
	logError: noIo,
});

function reader(input: { html?: string; url: string; documentUrl?: string }): { body: HTMLElement; title: string } {
	const parsed = parseHtml({ html: input.html ?? HTML, url: input.url, documentUrl: input.documentUrl ?? POST, thumbnailUrl: null });
	if (!parsed.ok) throw new Error(parsed.reason);
	return {
		title: parsed.article.title,
		body: parseHTML(`<html><body>${sanitizeArticleHtml(parsed.article.content)}</body></html>`).document.body,
	};
}

describe("signed-out Substack image previews in the reader", () => {
	it.each(IMAGES)("preserves the cutoff, public section and each image at its original position", ({ original }) => {
		const url = imageSave(original);
		const { title, body } = reader({ url });
		expect(title).toBe("Field Notes From the River");
		const content = Array.from(body.querySelectorAll("p, h2, h3, img"), (node) =>
			node.tagName === "IMG" ? node.getAttribute("src") : node.textContent?.trim(),
		);
		expect(content).toEqual([
			DECK,
			"Avery Chen",
			VISIBLE_PARAGRAPH,
			IMAGES[0].src,
			"Measuring the river",
			`In the next section of the survey, the volunteers worked from a field instruction sheet. ${VISIBLE_PARAGRAPH}`,
			IMAGES[1].src,
			"We packed the measuring equipment after the last morning reading.",
			DISCLOSURE,
		]);
		expect(Array.from(body.querySelectorAll("a[href]"), (node) => node.getAttribute("href"))).toEqual([
			"https://journal.example/@avery", "https://journal.example/bank-original",
			"https://journal.example/survey-guide", "https://journal.example/gauge-original",
		]);
		expect(Array.from(body.querySelectorAll("img"), (node) => [
			node.getAttribute("alt"), node.getAttribute("width"), node.getAttribute("height"),
		])).toEqual([["Sketch of the bank", "600", "800"], ["Gauge on the bridge", "640", "480"]]);
		expect(body.querySelector("p:last-child > strong")?.textContent).toBe(DISCLOSURE);
	});

	it.each([
		{ label: "missing", markup: "" },
		{ label: "blank", markup: '<h3 class="subtitle">   </h3>' },
		{ label: "nested", markup: `<div>${DECK_MARKUP}</div>` },
		{ label: "inert", markup: '<h3 class="subtitle" inert>Inert subtitle sentinel.</h3>' },
		{ label: "nonpublic descendants only", markup: '<h3 class="subtitle"><span hidden>Hidden subtitle sentinel.</span></h3>' },
		{ label: "ambiguous", markup: `${DECK_MARKUP}<h3 class="subtitle">Other visible subtitle.</h3>` },
		{ label: "duplicate nodes", markup: `${DECK_MARKUP}${DECK_MARKUP}` },
		{ label: "identical to the headline", markup: '<h3 class="subtitle">Field Notes From the River</h3>' },
	])("omits a $label subtitle while preserving the bounded preview", ({ markup }) => {
		const { body } = reader({ html: HTML.replace(DECK_MARKUP, markup), url: imageSave(IMAGES[0].original) });
		expect(body.querySelector("h3")).toBeNull();
		expect(body.querySelector("p")?.textContent).toBe("Avery Chen");
		expect(body.textContent?.trim().endsWith(DISCLOSURE)).toBe(true);
	});

	it("retains one visible direct subtitle and its emphasis beside an inert alternative", () => {
		const markup = HTML.replace(DECK_MARKUP,
			'<h3 class="subtitle" inert>Inert subtitle sentinel.</h3>' +
			'<h3 class="subtitle"><em>Notes</em> from the spring survey<span hidden>Hidden subtitle detail</span></h3>');
		const { body } = reader({ html: markup, url: imageSave(IMAGES[0].original) });
		const deck = body.querySelector("h3");
		expect(deck?.textContent).toBe(DECK);
		expect(deck?.querySelector("em")?.textContent).toBe("Notes");
		expect(deck?.nextElementSibling?.textContent).toBe("Avery Chen");
		expect(body.textContent).not.toContain("subtitle sentinel");
	});

	it("keeps a matching leading body block once in its authored paragraph position", () => {
		const markup = HTML.replace(`<p>${VISIBLE_PARAGRAPH}</p>`, `<p>${DECK}</p><p>${VISIBLE_PARAGRAPH}</p>`);
		const { body } = reader({ html: markup, url: imageSave(IMAGES[0].original) });
		expect(body.querySelector("h3")).toBeNull();
		expect(Array.from(body.querySelectorAll("p"), (node) => node.textContent?.trim()).slice(0, 3)).toEqual(["Avery Chen", DECK, VISIBLE_PARAGRAPH]);
		expect(body.textContent?.split(DECK)).toHaveLength(2);
	});

	it("keeps the publicly identified figure when the response itself uses the saved image route", () => {
		const url = imageSave(IMAGES[0].original);
		expect(reader({ url, documentUrl: url }).body.textContent).toContain(DISCLOSURE);
	});

	it.each([
		{
			label: "missing public marker",
			html: HTML.replace('class="available-content"', 'class="unidentified-content"'),
		},
		{
			label: "independently hidden public body",
			html: HTML.replace('class="available-content"', 'class="available-content" style="visibility: hidden"'),
		},
		{
			label: "hidden paywall label",
			html: HTML.replace('class="paywall-title"', 'class="paywall-title" hidden'),
		},
		{
			label: "non-adjacent paywall",
			html: HTML.replace('<div class="paywall" data-testid=', '<div></div><div class="paywall" data-testid='),
		},
		{
			label: "unrelated account panel",
			html: HTML.replace(DISCLOSURE, "Sign in to manage your account"),
		},
		{
			label: "ordinary short teaser",
			html: HTML.replaceAll(VISIBLE_PARAGRAPH, "Only a few lines were made public.").replace(HEADING, ""),
		},
		{
			label: "different saved figure",
			url: imageSave("https://substack-post-media.s3.amazonaws.com/public/another-figure.jpg"),
		},
		{
			label: "regular post save",
			url: POST,
		},
		{
			label: "different fetched document origin",
			documentUrl: "https://elsewhere.example/p/river-field-notes",
		},
		{
			label: "different fetched document path",
			documentUrl: "https://journal.example/account",
		},
		{
			label: "different fetched image target",
			documentUrl: imageSave(IMAGES[1].original),
		},
	])("leaves stock attribution and presentation for a $label", ({ html, url, documentUrl }) => {
		const { body } = reader({ html, url: url ?? imageSave(IMAGES[0].original), documentUrl });
		expect(body.textContent).not.toContain("Avery Chen");
	});
});

describe("public image permalink membership", () => {
	const savedUrl = imageSave(IMAGES[0].original);
	const bankFigure = `<figure><a href="/bank-original"><img src="${IMAGES[0].src}" alt="Sketch of the bank" width="600" height="800"></a></figure>`;

	it.each([
		{ label: "no saved image", url: "https://journal.example/i/123456" },
		{ label: "two saved image targets", url: `${savedUrl}&img=${encodeURIComponent(IMAGES[1].original)}` },
		{ label: "an unparseable saved image", url: imageSave("http://[") },
		{ label: "a nonpublic saved image", url: imageSave(IMAGES[0].original.replace("/public/", "/private/")) },
		{ label: "a malformed image source", markup: HTML.replace(IMAGES[0].src, "https://[") },
		{ label: "an image from a different CDN", markup: HTML.replace(IMAGES[0].src, IMAGES[0].src.replace("substackcdn.com", "elsewhere.example")) },
		{ label: "a CDN URL outside its image proxy", markup: HTML.replace(IMAGES[0].src, "https://substackcdn.com/public/bank-sketch.jpg") },
		{ label: "an invalid percent escape in the CDN proxy", markup: HTML.replace(IMAGES[0].src, "https://substackcdn.com/image/fetch/w_600/%XX") },
		{ label: "two visible copies of the saved image", markup: HTML.replace(bankFigure, bankFigure + bankFigure) },
		{ label: "a matching figure held in an inert element", markup: HTML.replace(bankFigure, `<div inert>${bankFigure}</div>`) },
		{ label: "a terminal URL that does not parse", terminal: "http://[" },
		{ label: "ambiguous canonical links", markup: HTML.replace('><meta property="og:url"', `><link rel="canonical" href="${POST}"><meta property="og:url"`) },
		{ label: "the Open Graph URL disagrees with the canonical", markup: HTML.replace(`property="og:url" content="${POST}"`, 'property="og:url" content="https://journal.example/p/other"') },
		{ label: "the published URL is outside the post route", markup: HTML.replaceAll(POST, "https://journal.example/notes/river-field-notes") },
		{ label: "an unrelated article wrapper", markup: HTML.replace('class="newsletter-post post"', 'class="different-layout post"') },
	])("keeps the stock document for $label", ({ url, markup, terminal }) => {
		const { document } = parseHTML(markup ?? HTML);
		const before = document.body.innerHTML;
		preserveSubstackImagePreview({ document, savedUrl: url ?? savedUrl, documentUrl: terminal ?? POST });
		expect(document.body.innerHTML).toBe(before);
	});

	it("keeps only named public bylines in source order", () => {
		const markup = HTML.replace('<a href="/@other" hidden>Hidden byline</a>',
			'<a href="/@other" hidden>Hidden byline</a><a href="/@empty"><span hidden>Hidden label</span></a><a href="/@sam"><span>Sam Lee</span><span inert>Unpublished byline detail</span></a>');
		const { body } = reader({ url: savedUrl, html: markup });
		const byline = body.querySelector("p");
		expect(byline?.textContent).toBe("Avery Chen, Sam Lee");
		expect(Array.from(byline?.querySelectorAll("a") ?? [], (link) => link.getAttribute("href"))).toEqual([
			"https://journal.example/@avery", "https://journal.example/@sam",
		]);
	});
});
