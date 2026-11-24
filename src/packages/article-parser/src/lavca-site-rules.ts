import { noExtract, noRecovery, skipCrawl, type SiteRules } from "@packages/site-rules";

const PUBLISHER_ORIGIN = "https://www.lavca.org";
const POST_PATH = /^\/[a-z0-9]+(?:-[a-z0-9]+)+\/?$/;
const HIDDEN = 'template, noscript, [hidden], [inert], [aria-hidden="true" i], [style*="display:none" i], [style*="display: none" i], [style*="visibility:hidden" i], [style*="visibility: hidden" i]';

export const lavcaSiteRules = {
	matches: ({ url }) => postPath(url) !== undefined,
	onCrawl: skipCrawl,
	recoverContent: noRecovery,
	extract: noExtract,
	transform: ({ document }, { savedUrl, documentUrl }) => {
		const path = postPath(savedUrl);
		if (!path || postPath(documentUrl) !== path) return;

		const canonical = unique(document, 'head > link[rel="canonical"][href]')?.getAttribute("href");
		const social = unique(document, 'head > meta[property="og:url"]')?.getAttribute("content");
		const timestamp = unique(document, 'head > meta[property="article:published_time"]')?.getAttribute("content");
		if (!canonical || !social || postPath(canonical) !== path || postPath(social) !== path ||
			!timestamp || Number.isNaN(Date.parse(timestamp))) return;

		const scope = unique(document, "body.single-post .upcoming-event-component");
		if (!scope) return;
		const header = unique(scope, ":scope > .upcoming-event .event-text");
		const prose = unique(scope, ":scope > div:not(.upcoming-event) .prose");
		const paragraph = prose && unique(prose, ":scope > p");
		if (!header || !paragraph || prose?.children.length !== 1) return;

		const category = header.firstElementChild;
		const heading = category?.nextElementSibling;
		const date = heading?.nextElementSibling;
		const categoryText = text(category);
		const title = text(heading);
		const dateText = text(date);
		if (category?.localName !== "h4" || heading?.localName !== "h2" || date?.localName !== "p" ||
			!categoryText || !title || !/^\d{1,2} [A-Za-z]+ \d{4}$/.test(dateText) || !text(paragraph)) return;
		const citation = unique(paragraph, "a[href]");
		const href = citation?.getAttribute("href");
		const target = href && URL.parse(href, documentUrl);
		if (!citation || !target || target.protocol !== "https:" || target.username || target.password ||
			!text(citation) || paragraph.querySelector("audio, iframe, img, script, style, video")) return;

		const article = document.createElement("article");
		const h1 = document.createElement("h1");
		h1.textContent = title;
		const categoryLine = document.createElement("p");
		categoryLine.textContent = categoryText;
		const dateLine = document.createElement("p");
		dateLine.textContent = dateText;
		article.append(h1, categoryLine, dateLine, paragraph);
		document.body.replaceChildren(article);
	},
} satisfies SiteRules;

function postPath(value: string): string | undefined {
	const url = URL.parse(value);
	if (!url || url.origin !== PUBLISHER_ORIGIN || url.username || url.password || !POST_PATH.test(url.pathname)) return undefined;
	return url.pathname.replace(/\/$/, "");
}

function unique(scope: ParentNode, selector: string): Element | undefined {
	const [element, duplicate] = scope.querySelectorAll(selector);
	return !duplicate && element && !element.closest(HIDDEN) && !element.querySelector(HIDDEN) ? element : undefined;
}

function text(element: Element | null | undefined): string {
	return element?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}
