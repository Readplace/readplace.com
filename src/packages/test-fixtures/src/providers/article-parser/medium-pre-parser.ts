import { parseHTML } from "linkedom";
import type { SiteArticleContent, SitePreParser } from "./article-parser.types";

type DomDocument = ReturnType<typeof parseHTML>["document"];
type DomElement = NonNullable<ReturnType<DomDocument["querySelector"]>>;

const ARTICLE_CONTAINER_SELECTORS = [
	"article",
	"main article",
	"main",
	'[data-testid="storyBody"]',
] as const;

const READ_TIME_REGEX = /^\s*\d{1,3}\s*min\s*read\s*$/i;
const PUBLISH_DATE_REGEX =
	/^\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,\s*\d{4})?\s*$/i;
const PICTURE_TOOLTIP_REGEX =
	/press\s+enter\s+or\s+click\s+to\s+view\s+image\s+in\s+full\s+size/i;
const CLAPS_SEPARATOR_REGEX = /^[-—]{2,}$/;
const STORIES_IN_INBOX_REGEX = /get\s+.+?['’‘]s\s+stories\s+in\s+your\s+inbox/i;
const JOIN_MEDIUM_REGEX = /^\s*join\s+medium\s+for\s+free\s+to\s+get\s+updates/i;
const REMEMBER_ME_REGEX = /^\s*remember\s+me\s+for\s+faster\s+sign\s+in\s*$/i;

const TITLE_SUFFIX_REGEX = /\s+[|\-–—]\s+.+$/;

/* Pre-parser for Medium-hosted articles.
 *
 * Medium nests its byline / read-time / publish-date / image-tooltip block
 * inside the same content container as the article body when the article
 * has an <h2> subtitle dek. Mozilla Readability's scoring then keeps that
 * chrome as "article content." This pre-parser locates the article
 * container, strips known noise nodes using a selector + text-fingerprint
 * check (so legitimate body content that coincidentally matches a phrase
 * isn't removed), and hands the cleaned body to the parser.
 *
 * `matches` is intentionally permissive (returns true for every hostname)
 * because Medium hosts thousands of custom domains in addition to
 * medium.com and *.medium.com; authoritative detection happens in
 * `extract` via an HTML fingerprint (`<meta property="og:site_name"
 * content="Medium">` or `<meta name="application-name" content="Medium">`).
 * `extract` returns `undefined` when the fingerprint is missing or the
 * article container can't be located, letting the default Readability
 * extraction handle the page. */
export const mediumPreParser: SitePreParser = {
	matches: () => true,
	extract: ({ html }): SiteArticleContent | undefined => {
		const { document } = parseHTML(html);

		if (!isMediumPage(document)) return undefined;

		const container = findArticleContainer(document);
		if (!container) return undefined;

		const bylineCluster = findBylineCluster(container);

		stripClapsSeparators({ container, bylineCluster });
		if (bylineCluster) {
			bylineCluster.remove();
		} else {
			container.querySelector('img[data-testid="authorPhoto"]')?.remove();
		}

		stripByDataTestId({ container, testId: "storyReadTime", textRegex: READ_TIME_REGEX });
		stripByDataTestId({ container, testId: "storyPublishDate", textRegex: PUBLISH_DATE_REGEX });
		stripPictureTooltip(container);
		stripFooterSubscribeCta(container);

		const title = extractTitle({ container, document });
		return { title, bodyHtml: container.innerHTML };
	},
};

function isMediumPage(document: DomDocument): boolean {
	const ogSiteName = document
		.querySelector('meta[property="og:site_name"]')
		?.getAttribute("content");
	if (ogSiteName === "Medium") return true;
	const appName = document
		.querySelector('meta[name="application-name"]')
		?.getAttribute("content");
	return appName === "Medium";
}

function findArticleContainer(document: DomDocument): DomElement | null {
	for (const selector of ARTICLE_CONTAINER_SELECTORS) {
		const found = document.querySelector(selector);
		if (found) return found;
	}
	return null;
}

function findBylineCluster(container: DomElement): DomElement | null {
	const authorImg = container.querySelector('img[data-testid="authorPhoto"]');
	if (!authorImg) return null;
	let candidate: DomElement | null = authorImg.parentElement;
	while (candidate) {
		if (isBylineCluster(candidate)) return candidate;
		candidate = candidate.parentElement;
	}
	return null;
}

function isBylineCluster(node: DomElement): boolean {
	if (node.tagName !== "DIV") return false;
	if (node.querySelector('[data-testid="storyReadTime"]')) return true;
	return node.querySelector('[data-testid="storyPublishDate"]') !== null;
}

/* c8 ignore start -- V8 block coverage phantom on typed-parameter destructuring + iterator, see bcoe/c8#319 */
function stripByDataTestId(params: {
	container: DomElement;
	testId: string;
	textRegex: RegExp;
}): void {
	const matches = params.container.querySelectorAll(`[data-testid="${params.testId}"]`);
	for (const node of matches) {
		const text = node.textContent ?? "";
		if (params.textRegex.test(text)) node.remove();
	}
}
/* c8 ignore stop */

/* Medium's image-tooltip text lives in a <span> directly inside the
 * figure > [role=button] interactive wrapper (raw HTML). Readability later
 * wraps stray spans in <p>, so the post-Readability shape includes a <p>
 * — but the pre-parser runs BEFORE Readability so we target the <span>.
 * We strip the span only; the sibling <picture> stays. */
function stripPictureTooltip(container: DomElement): void {
	const candidates = container.querySelectorAll('figure [role="button"] span');
	for (const span of candidates) {
		const text = span.textContent ?? "";
		if (PICTURE_TOOLTIP_REGEX.test(text)) span.remove();
	} /* c8 ignore next -- V8 block coverage phantom on for...of iterator close, see bcoe/c8#319 */
}

/* The "--" claps separator must follow the byline cluster in document
 * order — otherwise an em-dash-only paragraph inside body prose could be
 * stripped by accident. We capture the byline cluster's position before
 * it is removed and compare against each candidate <p>'s position. */
/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
function stripClapsSeparators(params: {
	container: DomElement;
	bylineCluster: DomElement | null;
}): void {
	if (!params.bylineCluster) return;
	const allElements = Array.from(params.container.querySelectorAll("*"));
	const bylineIndex = allElements.indexOf(params.bylineCluster);
	if (bylineIndex === -1) return;
	const paragraphs = params.container.querySelectorAll("p");
	/* c8 ignore next -- V8 block coverage phantom on for...of iterator protocol, see bcoe/c8#319 */
	for (const p of paragraphs) {
		const text = (p.textContent ?? "").trim();
		/* c8 ignore next -- V8 block coverage phantom on guard-continue inside iterator, see bcoe/c8#319 */
		if (!CLAPS_SEPARATOR_REGEX.test(text)) continue;
		const pIndex = allElements.indexOf(p);
		if (pIndex > bylineIndex) p.remove();
	}
}

/* Removes the "Get X's stories in your inbox" footer block. Once the
 * containing section/div is removed, the sibling "Join Medium for free…"
 * and "Remember me for faster sign in" paragraphs are gone for free. The
 * defensive sweep at the end catches layout variants where Medium renders
 * those CTAs outside the same container. */
function stripFooterSubscribeCta(container: DomElement): void {
	const headings = container.querySelectorAll("h2");
	for (const h2 of headings) {
		const text = h2.textContent ?? "";
		if (!STORIES_IN_INBOX_REGEX.test(text)) continue;
		/* c8 ignore next -- V8 block coverage phantom on call inside iterator, see bcoe/c8#319 */
		removeFooterCluster({ container, h2 });
		break;
	}
	const remainingPs = container.querySelectorAll("p");
	for (const p of remainingPs) {
		const text = p.textContent ?? "";
		if (isFooterCtaParagraph(text)) p.remove();
	}
}

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
function removeFooterCluster(params: { container: DomElement; h2: DomElement }): void {
	let cluster = params.h2.closest("section");
	if (cluster === null) cluster = params.h2.closest("div");
	if (cluster && cluster !== params.container) {
		cluster.remove();
		return;
	}
	params.h2.remove();
}

function isFooterCtaParagraph(text: string): boolean {
	if (JOIN_MEDIUM_REGEX.test(text)) return true;
	return REMEMBER_ME_REGEX.test(text);
}

function extractTitle(params: {
	container: DomElement;
	document: DomDocument;
}): string | undefined {
	const fromH1 = params.container.querySelector("h1")?.textContent?.trim();
	if (fromH1) return fromH1;
	const titleTag = params.document.querySelector("title")?.textContent?.trim();
	if (!titleTag) return undefined;
	const cleaned = titleTag.replace(TITLE_SUFFIX_REGEX, "").trim();
	return cleaned || undefined;
}
