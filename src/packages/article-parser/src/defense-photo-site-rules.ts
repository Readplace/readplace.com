import assert from "node:assert/strict";
import { noRecovery, noTransform, skipCrawl, type SiteArticleContent, type SiteRules } from "@packages/site-rules";
import { parseHTML } from "linkedom";

const PUBLISHER_ORIGINS = new Set(["https://www.defense.gov", "https://www.war.gov"]);
const PHOTO_PATH = /^\/Multimedia\/Photos\/igphoto\/([1-9]\d*)\/?$/i;
const ASSET_ORIGIN = "https://media.defense.gov";
const ASSET_PATH = /^\/(\d{4}\/[a-z]{3}\/\d{2})\/([1-9]\d*)\/(-1|[1-9]\d*)\/(-1|[1-9]\d*)\/\d+\/([^/]+\.jpe?g)$/i;
const HIDDEN = 'template, noscript, [hidden], [inert], [aria-hidden="true" i], [style*="display:none" i], [style*="display: none" i], [style*="visibility:hidden" i], [style*="visibility: hidden" i]';

export const defensePhotoSiteRules = {
	matches: ({ url }) => photoId(url) !== undefined,
	onCrawl: skipCrawl,
	recoverContent: noRecovery,
	transform: noTransform,
	extract: ({ html }, { savedUrl, documentUrl }): SiteArticleContent | undefined => {
		const id = photoId(savedUrl);
		if (!id || photoId(documentUrl) !== id) return undefined;

		const { document } = parseHTML(html);
		const canonical = unique(document, 'head > meta[property="og:url"]')?.getAttribute("content");
		const siteName = unique(document, 'head > meta[property="og:site_name"]')?.getAttribute("content");
		if (!canonical || photoId(canonical) !== id || !siteName?.trim()) return undefined;
		const scope = unique(document, "main article.image-gallery-detail");
		if (!scope) return undefined;

		const heading = unique(scope, ".inner-wrap-narrow > h1");
		const caption = unique(scope, ".inner-wrap-narrow > p");
		const picture = unique(scope, "a.details-url > img[src]");
		const download = unique(scope, "ul.meta > li.download > a[href]");
		const downloadLabel = unique(scope, "ul.meta > li.download > strong");
		const tag = unique(scope, "ul.meta > li.tags");
		const subjects = tag ? [...tag.querySelectorAll("a[href]")] : [];
		const tagLabel = tag && unique(tag, "strong");
		const credit = unique(scope, "ul.meta > li:not([class])");
		if (!heading || !caption || !picture || !download || !downloadLabel || !tagLabel || !subjects.length || !subjects.every(visible) || !credit) return undefined;

		const title = text(heading);
		const captionText = text(caption);
		const altText = picture.getAttribute("alt");
		const [creditField, assetField, extraField] = credit.querySelectorAll(":scope > span");
		if (!title || !captionText || !altText || !creditField || !assetField || extraField) return undefined;
		const sourceCredit = creditedField(creditField);
		const assetReference = creditedField(assetField);
		if (!sourceCredit || !assetReference || sourceCredit.label !== "Credit:") return undefined;
		const medium = asset(picture, "src", documentUrl);
		const full = asset(download, "href", documentUrl);
		const linked = asset(picture.parentElement, "href", documentUrl);
		const socialImage = unique(document, 'head > meta[property="og:image"]');
		const social = asset(socialImage, "content", documentUrl);
		if (!medium || !full || medium.id !== id || full.id !== id ||
			!medium.bounded || full.bounded || medium.family !== full.family ||
			linked?.href !== full.href || social?.href !== medium.href) return undefined;

		const topics = subjects.flatMap((subject) => {
			const url = publisherUrl(subject.getAttribute("href"), documentUrl);
			return url ? [{ url, label: text(subject) }] : [];
		});
		if (topics.length !== subjects.length) return undefined;
		const article = document.createElement("article");
		const figure = document.createElement("figure");
		const image = document.createElement("img");
		image.src = medium.href;
		image.alt = altText;
		append(figure, "p", anchor(document, full.href, image));
		append(figure, "figcaption", captionText);
		article.append(figure);
		labelledParagraph(article, text(downloadLabel), anchor(document, full.href, text(download)));
		labelledParagraph(article, text(tagLabel), ...topics.flatMap(({ url, label }, index) => {
			const link = anchor(document, url.href, label);
			return index ? [", ", link] : [link];
		}));
		labelledParagraph(article, sourceCredit.label, sourceCredit.value);
		labelledParagraph(article, assetReference.label, assetReference.value);
		return { title, siteName, bodyHtml: article.innerHTML };
	},
} satisfies SiteRules;

function photoId(value: string): string | undefined {
	const url = URL.parse(value);
	if (!url || !PUBLISHER_ORIGINS.has(url.origin) || url.username || url.password) return undefined;
	return PHOTO_PATH.exec(url.pathname)?.[1];
}

function publisherUrl(href: string | null, base: string): URL | undefined {
	const url = href ? URL.parse(href, base) : null;
	return url && PUBLISHER_ORIGINS.has(url.origin) && !url.username && !url.password ? url : undefined;
}

function asset(element: Element | null | undefined, attribute: string, base: string) {
	const raw = element?.getAttribute(attribute);
	if (!raw) return undefined;
	const url = URL.parse(raw, base);
	if (!url || url.origin !== ASSET_ORIGIN || url.username || url.password || url.search || url.hash) return undefined;
	const path = ASSET_PATH.exec(url.pathname);
	if (!path || (path[3] === "-1") !== (path[4] === "-1")) return undefined;
	return { href: url.href, id: path[2], bounded: path[3] !== "-1", family: [path[1], path[5]].join("/") };
}

function unique(scope: ParentNode, selector: string): Element | undefined {
	const [element, duplicate] = scope.querySelectorAll(selector);
	return !duplicate && element && visible(element) ? element : undefined;
}

function visible(element: Element): boolean {
	return !element.closest(HIDDEN) && !element.querySelector(HIDDEN);
}

function text(element: Element): string {
	const content = element.textContent;
	assert(content !== null, "An element provides textContent");
	return content.replace(/\s+/g, " ").trim();
}

function creditedField(field: Element): { label: string; value: string } | undefined {
	const heading = unique(field, "strong");
	if (!heading) return undefined;
	const label = text(heading);
	const content = text(field);
	const value = content.slice(label.length).trim();
	return content.startsWith(label) && value ? { label, value } : undefined;
}

function labelledParagraph(article: Element, label: string, ...contents: Array<string | Element>): void {
	const strong = article.ownerDocument.createElement("strong");
	strong.textContent = label;
	append(article, "p", strong, " ", ...contents);
}

function anchor(document: Document, href: string, contents: string | Element): HTMLAnchorElement {
	const link = document.createElement("a");
	link.href = href;
	link.append(contents);
	return link;
}

function append(parent: Element, tag: string, ...contents: Array<string | Element>): void {
	const element = parent.ownerDocument.createElement(tag);
	element.append(...contents);
	parent.append(element);
}
