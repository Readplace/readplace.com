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
 * `extract` via HTML fingerprints: `<meta property="og:site_name"
 * content="Medium">`, `<meta name="application-name" content="Medium">`,
 * or the presence of Medium-specific `data-testid` attributes
 * (`authorPhoto`, `storyReadTime`, `storyPublishDate`) — the last set
 * covers custom-domain pages served via friends-link redirects where
 * Medium omits the og:site_name meta tag.
 * `extract` returns `undefined` when no fingerprint matches, the
 * article container can't be located, or stripping reduced the body
 * below `MIN_BODY_CHARS` — in any of those cases the default Readability
 * extraction handles the page so we never emit an empty article. */
const MIN_BODY_CHARS = 200;

export const mediumPreParser: SitePreParser = {
	matches: () => true,
	extract: ({ html }): SiteArticleContent | undefined => {
		const { document } = parseHTML(html);

		if (!isMediumPage(document)) return undefined;

		const container = findArticleContainer(document);
		if (!container) return undefined;

		const authorPhoto = container.querySelector('[data-testid="authorPhoto"]');

		stripClapsSeparators({ container, anchorElement: authorPhoto });
		authorPhoto?.closest("a")?.remove();
		authorPhoto?.remove();

		stripWithEnclosingParagraph({
			container,
			testId: "storyReadTime",
			textRegex: READ_TIME_REGEX,
		});
		stripWithEnclosingParagraph({
			container,
			testId: "storyPublishDate",
			textRegex: PUBLISH_DATE_REGEX,
		});
		stripPictureTooltip(container);
		stripFooterSubscribeCta(container);

		const bodyHtml = container.innerHTML;
		/* Defensive fall-through: if our stripping dropped the body too,
		 * yield to the default Readability extraction rather than emit an
		 * empty article. The downstream parser then runs Readability on the
		 * raw HTML — chrome will leak through, but at least the body exists. */
		if (bodyHtml.length < MIN_BODY_CHARS) return undefined;

		const title = extractTitle({ container, document });
		return { title, bodyHtml };
	},
};

/* Medium-specific data-testid attributes used as secondary fingerprints
 * when the og:site_name / application-name meta tags are absent (e.g.
 * custom-domain pages served via friends-link redirects). */
const MEDIUM_DATA_TESTID_SELECTOR =
	'[data-testid="authorPhoto"], [data-testid="storyReadTime"], [data-testid="storyPublishDate"]';

function isMediumPage(document: DomDocument): boolean {
	const ogSiteName = document
		.querySelector('meta[property="og:site_name"]')
		?.getAttribute("content");
	if (ogSiteName === "Medium") return true;
	const appName = document
		.querySelector('meta[name="application-name"]')
		?.getAttribute("content");
	if (appName === "Medium") return true;
	return document.querySelector(MEDIUM_DATA_TESTID_SELECTOR) !== null;
}

function findArticleContainer(document: DomDocument): DomElement | null {
	for (const selector of ARTICLE_CONTAINER_SELECTORS) {
		const found = document.querySelector(selector);
		if (found) return found;
	}
	return null;
}


/* c8 ignore start -- V8 block coverage phantom on typed-parameter destructuring + iterator, see bcoe/c8#319 */
function stripWithEnclosingParagraph(params: {
	container: DomElement;
	testId: string;
	textRegex: RegExp;
}): void {
	const matches = params.container.querySelectorAll(`[data-testid="${params.testId}"]`);
	for (const node of matches) {
		const text = node.textContent ?? "";
		if (!params.textRegex.test(text)) continue;
		const enclosingParagraph = node.closest("p");
		const target = enclosingParagraph ?? node;
		target.remove();
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

/* The "--" claps separator must follow the byline anchor in document
 * order — otherwise an em-dash-only paragraph inside body prose could be
 * stripped by accident. We use the author photo's position as the anchor;
 * if there is no author photo, claps are not stripped. */
/* c8 ignore start -- V8 block coverage phantom on typed-parameter destructuring + iterator + guard-continue, see bcoe/c8#319 */
function stripClapsSeparators(params: {
	container: DomElement;
	anchorElement: DomElement | null;
}): void {
	if (!params.anchorElement) return;
	const allElements = Array.from(params.container.querySelectorAll("*"));
	const anchorIndex = allElements.indexOf(params.anchorElement);
	if (anchorIndex === -1) return;
	const paragraphs = params.container.querySelectorAll("p");
	for (const p of paragraphs) {
		const text = (p.textContent ?? "").trim();
		if (!CLAPS_SEPARATOR_REGEX.test(text)) continue;
		const pIndex = allElements.indexOf(p);
		if (pIndex > anchorIndex) p.remove();
	}
}
/* c8 ignore stop */

/* Removes the "Get X's stories in your inbox" h2 and any join-medium /
 * remember-me CTA paragraphs anywhere inside the article container.
 *
 * Earlier versions tried to remove the h2's enclosing <section> or <div>
 * to wipe the whole subscribe widget in one shot, but Medium's SSR
 * sometimes nests the subscribe h2 inside the article body's main
 * <section> (the one wrapping the entire prose), so removing the
 * "container" obliterated the body too. The narrow version just removes
 * the h2 and the CTA paragraphs by their text fingerprint — the empty
 * wrapping div remains in the bodyHtml but contributes no rendered text. */
/* c8 ignore start -- V8 block coverage phantom on for...of iterator + function declaration, see bcoe/c8#319 */
function stripFooterSubscribeCta(container: DomElement): void {
	const headings = container.querySelectorAll("h2");
	for (const h2 of headings) {
		const text = h2.textContent ?? "";
		if (!STORIES_IN_INBOX_REGEX.test(text)) continue;
		h2.remove();
		break;
	}
	const remainingPs = container.querySelectorAll("p");
	for (const p of remainingPs) {
		const text = p.textContent ?? "";
		if (isFooterCtaParagraph(text)) p.remove();
	}
}

function isFooterCtaParagraph(text: string): boolean {
	if (JOIN_MEDIUM_REGEX.test(text)) return true;
	return REMEMBER_ME_REGEX.test(text);
}
/* c8 ignore stop */

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
