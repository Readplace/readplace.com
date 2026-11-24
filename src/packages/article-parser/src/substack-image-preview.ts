import assert from "node:assert/strict";

const INACCESSIBLE = "script, style, noscript, template, [hidden], [inert], [aria-hidden=true i]";
const HIDDEN_STYLE = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))\s*(?:!important\s*)?(?:;|$)/i;
const PAID_SUBSCRIBERS_NOTICE = "This post is for paid subscribers";
const IMAGE_ROUTE = /^\/i\/\d+$/;
const POST_ROUTE = /^\/p\/[^/]+$/;
const SUBSTACK_IMAGE_PROXY = /^\/image\/fetch\/[^/]+\/([^/]+)$/;
const SUBSTACK_MEDIA_ORIGIN = "https://substack-post-media.s3.amazonaws.com";

function publicText(element: Element): string {
	return String(element.textContent).replace(/\s+/g, " ").trim();
}

function isHidden(element: Element): boolean {
	return element.matches(INACCESSIBLE) || HIDDEN_STYLE.test(element.getAttribute("style") ?? "");
}

function hasHiddenAncestor(element: Element): boolean {
	for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
		if (isHidden(ancestor)) return true;
	}
	return false;
}

function removeHiddenDescendants(element: Element): void {
	for (const child of element.querySelectorAll(`${INACCESSIBLE}, [style]`)) {
		if (isHidden(child)) child.remove();
	}
}

function copyPublicChildren(source: Element, destination: Element): void {
	for (const child of source.childNodes) destination.append(child.cloneNode(true));
	removeHiddenDescendants(destination);
}

function singleVisibleElement(root: Document | Element, selector: string): Element | undefined {
	const elements = root.querySelectorAll(selector);
	const element = elements.item(0);
	return elements.length === 1 && element && !hasHiddenAncestor(element) ? element : undefined;
}

function matchingSavedImage(params: { saved: URL; documentUrl: URL; body: Element }): boolean {
	const target = params.saved.searchParams.getAll("img");
	if (target.length !== 1) return false;
	const media = URL.parse(target[0]);
	if (media?.origin !== SUBSTACK_MEDIA_ORIGIN || !media.pathname.startsWith("/public/")) return false;

	const matches = Array.from(params.body.querySelectorAll("figure img[src]")).filter((image) => {
		const source = image.getAttribute("src");
		assert(source !== null, "The figure image selector requires a src attribute");
		const src = URL.parse(source, params.documentUrl);
		if (src?.origin !== "https://substackcdn.com") return false;
		const match = SUBSTACK_IMAGE_PROXY.exec(src.pathname);
		if (!match) return false;
		try {
			return decodeURIComponent(match[1]) === media.href;
		} catch {
			return false;
		}
	});
	return matches.length === 1;
}

function addPublicSubtitle(params: { article: Element; header: Element; title: Element; body: Element; document: Document }): void {
	const subtitles = Array.from(params.header.querySelectorAll(":scope > h3.subtitle")).filter((element) => !hasHiddenAncestor(element));
	if (subtitles.length !== 1) return;

	const subtitle = params.document.createElement("h3");
	copyPublicChildren(subtitles[0], subtitle);
	const text = publicText(subtitle);
	if (!text || text === publicText(params.title)) return;

	const openingBlock = params.body.querySelector("p, blockquote, ul, ol, h1, h2, h3, h4, h5, h6, figure");
	assert(openingBlock, "The public preview contains a heading and a figure");
	if (text === publicText(openingBlock)) return;

	params.article.append(subtitle);
}

function addPublicByline(params: { article: Element; header: Element; document: Document }): void {
	const byline = params.document.createElement("p");
	for (const link of params.header.querySelectorAll(".byline-wrapper a[href]")) {
		if (hasHiddenAncestor(link)) continue;
		const copy = params.document.createElement("span");
		copyPublicChildren(link, copy);
		const text = publicText(copy);
		if (!text) continue;
		const author = params.document.createElement("a");
		author.textContent = text;
		const href = link.getAttribute("href");
		assert(href !== null, "The byline selector requires an href attribute");
		author.setAttribute("href", href);
		if (byline.childNodes.length) byline.append(", ");
		byline.append(author);
	}
	if (byline.childNodes.length) params.article.append(byline);
}

/* The image permalink identifies a figure in the visible post. Keep that
 * public article in its source order and attach its own adjacent cutoff
 * before Readability scores the page. */
export function preserveSubstackImagePreview(params: {
	document: Document;
	savedUrl: string;
	documentUrl: string;
}): void {
	const { document } = params;
	const saved = URL.parse(params.savedUrl);
	const documentUrl = URL.parse(params.documentUrl);
	if (saved?.protocol !== "https:" || !IMAGE_ROUTE.test(saved.pathname) || documentUrl?.origin !== saved.origin) return;
	const canonical = singleVisibleElement(document, 'head > link[rel="canonical"]')?.getAttribute("href");
	if (!canonical || document.querySelector('head > meta[property="og:url"]')?.getAttribute("content") !== canonical) return;
	const post = URL.parse(canonical);
	if (post?.origin !== saved.origin || !POST_ROUTE.test(post.pathname)) return;
	const sameImageRoute = documentUrl.pathname === saved.pathname && documentUrl.searchParams.get("img") === saved.searchParams.get("img");
	if (!sameImageRoute && documentUrl.pathname !== post.pathname) return;

	const sourceArticle = singleVisibleElement(document, "article.newsletter-post.post");
	if (!sourceArticle) return;
	const header = singleVisibleElement(sourceArticle, ":scope > .post-header");
	const title = header && singleVisibleElement(header, ":scope > h1.post-title.published");
	const postBody = singleVisibleElement(sourceArticle, ".dt-post-body");
	const publicBody = postBody && singleVisibleElement(postBody, ":scope > .available-content > .body.markup");
	const paywall = postBody?.nextElementSibling;
	if (!header || !title || !publicText(title) || !publicBody || !paywall?.matches('.paywall[data-testid="paywall"]')) return;
	const notice = singleVisibleElement(paywall, ":scope > h2.paywall-title");
	if (notice?.childElementCount !== 0 || publicText(notice) !== PAID_SUBSCRIBERS_NOTICE) return;

	const body = document.createElement("div");
	copyPublicChildren(publicBody, body);
	const anchoredHeadings = body.querySelectorAll("h1.header-anchor-post");
	if (!anchoredHeadings.length || !matchingSavedImage({ saved, documentUrl, body })) return;
	for (const heading of anchoredHeadings) {
		const retained = document.createElement("h2");
		for (const attribute of heading.attributes) retained.setAttribute(attribute.name, attribute.value);
		retained.append(...heading.childNodes);
		heading.replaceWith(retained);
	}

	const article = document.createElement("article");
	addPublicSubtitle({ article, header, title, body, document });
	addPublicByline({ article, header, document });
	article.append(...body.childNodes);
	const cutoff = document.createElement("p");
	const label = document.createElement("strong");
	label.textContent = publicText(notice);
	cutoff.append(label);
	article.append(cutoff);
	// Readability uses the publisher's page metadata before stripping these scripts.
	const metadata = Array.from(document.querySelectorAll('#main > div > script[type="application/ld+json"]'));
	document.body.replaceChildren(...metadata, article);
}
