import { noRecovery, noTransform, skipCrawl, type SiteArticleContent, type SiteRules } from "@packages/site-rules";
import { parseHTML } from "linkedom";

const PUBLISHER = "https://xkcd.com";
const IMAGE_ORIGIN = "https://imgs.xkcd.com";
const HIDDEN = 'template, noscript, [hidden], [inert], [aria-hidden="true" i], [style*="display:none" i], [style*="display: none" i], [style*="visibility:hidden" i], [style*="visibility: hidden" i]';

export const xkcdSiteRules = {
	matches: ({ url }) => comicId(url) !== undefined,
	onCrawl: skipCrawl,
	recoverContent: noRecovery,
	transform: noTransform,
	extract: ({ html }, { savedUrl, documentUrl }): SiteArticleContent | undefined => {
		const id = comicId(savedUrl);
		if (!id || comicId(documentUrl) !== id) return undefined;

		const { document } = parseHTML(html);
		const canonical = uniqueVisible(document, 'head > meta[property="og:url"]')?.getAttribute("content");
		const siteName = uniqueVisible(document, 'head > meta[property="og:site_name"]')?.getAttribute("content");
		const scope = uniqueVisible(document, "body > #middleContainer");
		if (!canonical || comicId(canonical) !== id || !scope || !siteName?.trim()) return undefined;

		const heading = uniqueVisible(scope, ":scope > #ctitle");
		const image = uniqueVisible(scope, ":scope > #comic > img[src], :scope > #comic > a > img[src]");
		const wrapper = image?.parentElement?.matches("a") ? image.parentElement : undefined;
		const panelLink = wrapper ? webUrl(wrapper.getAttribute("href"), documentUrl) : undefined;
		if (wrapper && !panelLink) return undefined;
		const title = heading?.textContent?.trim();
		const alt = image?.getAttribute("alt");
		const hover = image?.getAttribute("title");
		const base = imageUrl(image?.getAttribute("src"), documentUrl);
		if (!heading || heading.querySelector(HIDDEN) || !title || !image || alt !== title || !hover?.trim() || !base) return undefined;

		const srcset = image.getAttribute("srcset");
		const density = imageUrl(srcset?.trim().match(/^(\S+)\s+2x$/)?.[1], documentUrl);
		if (srcset !== null && (!density || density.pathname !== base.pathname.replace(/(\.[a-z]+)$/i, "_2x$1"))) return undefined;
		const socialImage = uniqueVisible(document, 'head > meta[property="og:image"]')?.getAttribute("content");
		const declared = imageUrl(socialImage, documentUrl);
		if (!declared || (declared.href !== base.href && declared.href !== density?.href)) return undefined;

		// The template publishes both the work and hotlink URLs below the panel.
		const links = [...scope.querySelectorAll(":scope > a[href]")].filter((link) => !link.closest(HIDDEN));
		const [permalink, imageLink, duplicate] = links;
		const workHref = permalink?.getAttribute("href");
		const imageHref = imageUrl(imageLink?.getAttribute("href"), documentUrl);
		if (duplicate || !workHref || comicId(workHref) !== id || imageHref?.href !== base.href) return undefined;

		const workLabel = precedingLabel(permalink);
		const imageLabel = precedingLabel(imageLink);
		const workText = permalink.textContent?.trim();
		const imageText = imageLink.textContent?.trim();
		if (workLabel !== "Permanent link to this comic:" || imageLabel !== "Image URL (for hotlinking/embedding):" ||
			!workText || comicId(workText) !== id || !imageText || imageUrl(imageText, documentUrl)?.href !== base.href) return undefined;

		const article = document.createElement("article");
		const figure = document.createElement("figure");
		const shown = document.createElement("img");
		shown.src = base.href;
		shown.alt = alt;
		shown.title = hover;
		if (density) shown.setAttribute("srcset", `${density.href} 2x`);
		if (panelLink) {
			const anchor = document.createElement("a");
			anchor.href = panelLink.href;
			anchor.append(shown);
			append(figure, "p", anchor);
		} else {
			append(figure, "p", shown);
		}
		append(figure, "figcaption", hover);
		article.append(figure);
		append(article, "p", `${workLabel} `, link(document, workHref, workText));
		append(article, "p", `${imageLabel} `, link(document, imageHref.href, imageText));
		const license = uniqueVisible(document, "body > #bottom > #licenseText");
		if (license) {
			for (const paragraph of license.querySelectorAll(":scope > p")) {
				if (!paragraph.closest(HIDDEN) && !paragraph.querySelector(HIDDEN)) article.append(paragraph);
			}
		}
		return { title, siteName, bodyHtml: article.innerHTML };
	},
} satisfies SiteRules;

function comicId(value: string): string | undefined {
	const url = URL.parse(value);
	if (!url || url.origin !== PUBLISHER || url.username || url.password) return undefined;
	return /^\/([1-9]\d*)\/?$/.exec(url.pathname)?.[1];
}

function imageUrl(value: string | null | undefined, base: string): URL | undefined {
	if (!value) return undefined;
	const url = URL.parse(value, base);
	if (!url || url.origin !== IMAGE_ORIGIN || url.username || url.password || url.search || url.hash ||
		!/^\/comics\/[^/]+\.(?:gif|png|jpe?g|webp)$/i.test(url.pathname)) return undefined;
	return url;
}

function webUrl(value: string | null, base: string): URL | undefined {
	const url = value ? URL.parse(value, base) : null;
	return url?.protocol === "http:" || url?.protocol === "https:" ? url : undefined;
}

function uniqueVisible(scope: ParentNode, selector: string): Element | undefined {
	const [element, duplicate] = scope.querySelectorAll(selector);
	return element && !duplicate && !element.closest(HIDDEN) ? element : undefined;
}

function precedingLabel(anchor: Element): string | undefined {
	const text = anchor.previousSibling;
	return text?.nodeType === 3 ? text.textContent?.trim() : undefined;
}

function link(document: Document, href: string, label: string): HTMLAnchorElement {
	const anchor = document.createElement("a");
	anchor.href = href;
	anchor.textContent = label;
	return anchor;
}

function append(parent: Element, tag: string, ...content: Array<string | Element>): void {
	const child = parent.ownerDocument.createElement(tag);
	child.append(...content);
	parent.append(child);
}
