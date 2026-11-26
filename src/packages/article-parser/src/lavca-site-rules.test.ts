import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { initArticleSiteRules } from "./article-site-rules";
import { lavcaSiteRules } from "./lavca-site-rules";
import { readabilityAdditions } from "./readability-additions";
import { initReadabilityParser } from "./readability-parser";

const documentUrl = "https://www.lavca.org/wetland-technology-funding/";
const url = `${documentUrl}?utm_source=feed`;
const citation = "https://example.net/press/releases/seed";
const title = "Wetland Monitoring Company Announces Seed Round";
const markup = [
	'<html><head><title>Wetland Monitoring Company Announces Seed Round | Publisher</title>',
	'<meta property="og:site_name" content="Funding News">',
	'<meta property="article:published_time" content="2026-04-03T14:00:00+00:00">',
	`<link rel="canonical" href="${documentUrl}">`,
	`<meta property="og:url" content="${documentUrl}">`,
	'</head><body class="single-post"><main><div class="upcoming-event-component">',
	'<div class="upcoming-event"><div class="event"><div class="event-text">',
	`<h4>Funding News</h4><h2>${title}</h2><p>3 April 2026</p></div></div></div>`,
	'<div><div class="prose"><p>',
	`<b>River Atelier</b> raised <b>USD4m</b> in seed financing in Chile, led by Pine Fund and joined by Finch Capital, per <a href="${citation}">the release</a>.`,
	'</p></div></div></div><aside><h2>Related stories</h2><p>Other companies recently hired more staff after moving offices.</p></aside>',
	'</main></body></html>',
].join("");

describe("LAVCA funding briefs", () => {
	it("uses the article's short text, citation, category and displayed and structured dates", () => {
		const unavailable = () => { throw new Error("Already fetched"); };
		const { siteRules } = initArticleSiteRules({ crawlFetch: unavailable, logError: unavailable });
		const { parseHtml } = initReadabilityParser({ coverageRules: { inspect: () => [] }, crawlArticle: unavailable, siteRules, readabilityAdditions, logError: unavailable });

		const result = parseHtml({ url, documentUrl, html: markup, thumbnailUrl: null });

		assert(result.ok);
		const document = parseHTML(result.article.content).document;
		expect(result.article.title).toBe(title);
		expect(result.article.siteName).toBe("Funding News");
		expect(result.article.publishedOn).toBe("2026-04-03");
		expect([...document.querySelectorAll("p")].map((line) => line.textContent)).toEqual([
			"Funding News", "3 April 2026",
			"River Atelier raised USD4m in seed financing in Chile, led by Pine Fund and joined by Finch Capital, per the release.",
		]);
		expect([...document.querySelectorAll("a[href]")].map((link) => [link.textContent, link.getAttribute("href")])).toEqual([["the release", citation]]);
	});

	it.each([
		["another publisher", markup, "https://example.net/wetland-technology-funding/"],
		["a different post", markup, "https://www.lavca.org/published-quarterly-report/"],
		["a missing canonical", markup.replace('rel="canonical"', 'rel="alternate"'), documentUrl],
		["a hidden brief", markup.replace('class="prose"', 'class="prose" hidden'), documentUrl],
		["a missing dateline", markup.replace("<p>3 April 2026</p>", ""), documentUrl],
		["a missing citation", markup.replace("<a href=", "<span data-href=").replace("</a>", "</span>"), documentUrl],
		["a listing template", markup.replace("single-post", "archive"), documentUrl],
		["an ambiguous brief", markup.replace('class="prose"><p>', 'class="prose"><p>Another lead.</p><p>'), documentUrl],
	])("leaves the source intact for %s", (_name, html, landed) => {
		const { document } = parseHTML(html);
		const before = document.toString();

		lavcaSiteRules.transform({ document }, { savedUrl: url, documentUrl: landed });

		expect(document.toString()).toBe(before);
	});
});
