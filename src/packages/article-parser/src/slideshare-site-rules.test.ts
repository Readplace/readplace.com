import assert from "node:assert/strict";
import { sanitizeArticleHtml } from "@packages/domain";
import { parseHTML } from "linkedom";
import { initArticleSiteRules } from "./article-site-rules";
import { initReadabilityParser } from "./readability-parser";
import { readabilityAdditions } from "./readability-additions";
import { slideshareSiteRules } from "./slideshare-site-rules";

const url = "https://www.slideshare.net/example/synthetic-presentation";
const description = "A synthetic presentation about preserving complete slide captions and their illustrations. Readers need the sequence, including slides with no text, to follow the argument and understand how each illustration relates to the surrounding discussion.";
const longCaption = "1. Complete caption The introductory heading is followed by the entire explanation, with enough detail to distinguish a complete transcript from a heading-only extraction. Every continuation belongs to this slide and must remain present in the saved presentation.";
const captions = [longCaption, "3. Think small", '4. Text <script>alert("unsafe")</script> & symbols'];

function presentation(): string {
	return `<!DOCTYPE html><html><head><title>Presentation platform</title><link rel="canonical" href="${url}"></head><body>
		<nav><a href="/browse">Browse presentations</a></nav>
		<div id="main"><h1>Synthetic presentation</h1>
		<div class="description"><a href="/category">Category navigation</a><p data-cy="document-description">${description}<a href="/related" onclick="unsafe()">Related material</a><button>Read more</button></p></div>
		<div class="player">${Array.from({ length: 4 }, (_, index) => `<div class="slide-item" id="slide${index + 1}"><img src="/slides/${index + 1}.jpg" alt="Illustration ${index + 1}" onerror="unsafe()"></div>`).join("")}</div></div>
		<template id="B:7"></template><div hidden id="S:7"><div class="transcript"><ul>
		<li><span>1. </span><div><a href="#1">Complete caption</a> The introductory heading is followed by the entire explanation, with enough detail to distinguish a complete transcript from a heading-only extraction. Every continuation belongs to this slide and must remain present in the saved presentation.</div></li>
		<li><div><a href="#3">3. Think small</a></div></li>
		<li><div><a href="#4">4. Text</a> &lt;script&gt;alert(&quot;unsafe&quot;)&lt;/script&gt; &amp; symbols</div></li>
		</ul></div></div><script>$RC("B:7","S:7")</script>
		<div hidden id="S:0"><div class="recommendations"><img src="/recommended.jpg"><p>Unrelated recommended deck</p></div></div>
		</body></html>`;
}

function parsePresentation(html: string) {
	const neverFetch = async () => { throw new Error("Parsing a captured presentation must not fetch"); };
	const { siteRules } = initArticleSiteRules({ crawlFetch: neverFetch, logError: () => {} });
	const parser = initReadabilityParser({ crawlArticle: neverFetch, siteRules, readabilityAdditions, logError: () => {} });
	return parser.parseHtml({ url, documentUrl: url, html, thumbnailUrl: null });
}

describe("SlideShare presentation extraction", () => {
	it("preserves complete ordered captions and requested slide images through the registered parser", () => {
		const result = parsePresentation(presentation());
		expect(result.ok).toBe(true);
		assert(result.ok);
		const { document } = parseHTML(sanitizeArticleHtml(result.article.content));
		expect(result.article.title).toBe("Synthetic presentation");
		const paragraph = document.querySelector("p");
		assert(paragraph);
		expect(Array.from(document.querySelectorAll("p"), (element) => element.textContent)).toEqual([`${description}Related material`]);
		const descriptionLink = paragraph.querySelector("a");
		assert(descriptionLink);
		expect(descriptionLink.outerHTML).toBe('<a href="https://www.slideshare.net/related">Related material</a>');
		const transcript = document.querySelector("ul");
		assert(transcript);
		expect(transcript.tagName).toBe("UL");
		expect(Array.from(transcript.children, (item) => item.textContent)).toEqual(captions);
		expect(Array.from(document.querySelectorAll("img"), (image) => image.getAttribute("src"))).toEqual(
			[1, 2, 3, 4].map((number) => `https://www.slideshare.net/slides/${number}.jpg`),
		);
		expect(Array.from(document.querySelectorAll("img"), (image) => image.getAttribute("alt"))).toEqual(
			[1, 2, 3, 4].map((number) => `Illustration ${number}`),
		);
		expect(Array.from(document.querySelectorAll("img"), (image) => image.outerHTML)).toEqual(
			[1, 2, 3, 4].map((number) => `<img alt="Illustration ${number}" src="https://www.slideshare.net/slides/${number}.jpg">`),
		);
		expect(Array.from(document.querySelectorAll("li > a"), (link) => ({ text: link.textContent, href: link.getAttribute("href") }))).toEqual([
			{ text: "Complete caption", href: `${url}#1` },
			{ text: "3. Think small", href: `${url}#3` },
			{ text: "4. Text", href: `${url}#4` },
		]);
	});

	it("also extracts an already visible transcript without stream completion markup", () => {
		expect(slideshareSiteRules.extract({ html: presentation().replace('hidden id="S:7"', 'id="visible"').replace('<script>$RC("B:7","S:7")</script>', '') })).toBeDefined();
	});

	it.each([
		["challenge page", "<html><body><h1>Checking your browser</h1></body></html>"],
		["missing canonical identity", presentation().replace(`<link rel="canonical" href="${url}">`, "")],
		["invalid canonical identity", presentation().replace(`href="${url}"`, 'href="not-a-url"')],
		["non-HTTP canonical identity", presentation().replace(`href="${url}"`, 'href="javascript:unsafe()"')],
		["missing title", presentation().replace('<h1>Synthetic presentation</h1>', '')],
		["empty title", presentation().replace('Synthetic presentation</h1>', ' </h1>')],
		["missing transcript", presentation().replace('class="transcript"', 'class="unrelated"')],
		["missing player", presentation().replace('class="player"', 'class="unrelated"')],
		["missing captions", presentation().replace(/<li>[\s\S]*?<\/li>/g, '')],
		["missing caption link", presentation().replace('<a href="#3">3. Think small</a>', "3. Think small")],
		["empty caption link", presentation().replace('<a href="#3">3. Think small</a>', '<a href="#3"></a>')],
		["missing image source", presentation().replace('src="/slides/1.jpg"', '')],
		["unknown hidden carrier", presentation().replace('id="S:7"', 'id="unknown"')],
		["missing boundary", presentation().replace('<template id="B:7"></template>', '')],
		["incomplete boundary", presentation().replace('$RC("B:7","S:7")', '$RC("B:8","S:7")')],
	])("declines %s instead of manufacturing presentation content", (_name, html) => {
		expect(slideshareSiteRules.extract({ html })).toBeUndefined();
	});

	it("retains presentations without descriptions or image alt attributes", () => {
		const html = presentation().replace(/<div class="description">[\s\S]*?<\/div>/, '').replace(/ alt="Illustration \d"/g, '');
		const extracted = slideshareSiteRules.extract({ html });
		expect(extracted).toBeDefined();
		assert(extracted);
		const { document } = parseHTML(extracted.bodyHtml);
		expect(document.querySelectorAll("img")).toHaveLength(4);
		expect(Array.from(document.querySelectorAll("img"), (image) => image.outerHTML)).toEqual(
			[1, 2, 3, 4].map((number) => `<img src="/slides/${number}.jpg">`),
		);
	});

	it.each([
		["www.slideshare.net", true],
		["slideshare.net", true],
		["slideshare.net.example.com", false],
		["example.com", false],
	])("matches only the confirmed presentation host %s", (hostname, expected) => {
		expect(slideshareSiteRules.matches({ hostname, url })).toBe(expected);
	});
});
