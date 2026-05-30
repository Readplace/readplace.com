import assert from "node:assert";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import type { CrawlArticle } from "@packages/crawl-article";
import type {
	ParseArticle,
	ParseHtml,
	SiteArticleContent,
	SitePreParser,
} from "./article-parser.types";
import { replaceVideosWithPlaceholder } from "./replace-videos-with-placeholder";
import { resolveRelativeUrls } from "./resolve-relative-urls";

export function initReadabilityParser(deps: {
	crawlArticle: CrawlArticle;
	sitePreParsers: readonly SitePreParser[];
	logError: (message: string, error?: Error) => void;
}): { parseArticle: ParseArticle; parseHtml: ParseHtml } {
	const parseHtml: ParseHtml = (params) => {
		let hostname: string;
		try {
			hostname = new URL(params.url).hostname;
		} catch {
			return { ok: false, reason: "Invalid URL" };
		}

		const extracted = tryExtractFromPreParsers({
			preParsers: deps.sitePreParsers,
			hostname,
			html: params.html,
			url: params.url,
			logError: deps.logError,
		});

		const { document } = parseHTML(
			extracted ? buildSyntheticHtml(extracted) : params.html,
		);
		// Any throw from normalization, Readability construction, or
		// Readability.parse() becomes a terminal parse failure so
		// save-link-work can markCrawlFailed immediately — otherwise it
		// escapes the whole pipeline and the reader slot is stuck on
		// "pending" until the SQS → DLQ path ticks over. Readability 0.6
		// still crashes on pages whose DOM shape trips its heuristics
		// (mozilla/readability #435, #757); we normalize the common
		// linkedom-implicit-body shape above but other shapes remain.
		let parsed: ReturnType<Readability["parse"]>;
		try {
			normalizeImplicitBody(document);
			replaceVideosWithPlaceholder({
				document,
				originalUrl: params.url,
				renderPlaceholder: renderVideoPlaceholder,
			});
			/* `reader-video-placeholder` joins Readability's default
			 * `CLASSES_TO_PRESERVE` (concat'd internally) so the CSS hook
			 * survives `_cleanClasses`; the <p> tag is also exempt from
			 * `_cleanConditionally`, keeping the link-bearing callout from
			 * being dropped for link density. */
			parsed = new Readability(document, {
				classesToPreserve: ["reader-video-placeholder"],
			}).parse();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { ok: false, reason: `Readability parse failed: ${message}` };
		}

		if (!parsed) {
			return {
				ok: true,
				article: {
					title: `Article from ${hostname}`,
					siteName: hostname,
					excerpt: `Content saved from ${hostname}.`,
					wordCount: 0,
					content: "",
					imageUrl: params.thumbnailUrl ?? undefined,
				},
			};
		}

		assert(parsed.textContent != null, "Readability provides textContent for parsed articles");
		assert(parsed.content != null, "Readability provides content for parsed articles");

		return {
			ok: true,
			/* c8 ignore next -- V8 block coverage phantom on object-literal start when followed by cascading `||` fallbacks (bcoe/c8#319, v8.dev/blog/javascript-code-coverage) */
			article: {
				title: parsed.title || `Article from ${hostname}`,
				siteName: parsed.siteName || hostname,
				excerpt: parsed.excerpt || `Content saved from ${hostname}.`,
				wordCount: Array.from(parsed.textContent.matchAll(/\S+/g)).length, /* c8 ignore next -- V8 block coverage phantom: zero-count sub-range at bytecode boundary (bcoe/c8#319, v8.dev/blog/javascript-code-coverage) */
				content: resolveRelativeUrls({ html: parsed.content, baseUrl: params.url }),
				imageUrl: params.thumbnailUrl ?? undefined,
			},
		};
	};

	const parseArticle: ParseArticle = async (url) => {
		try {
			new URL(url);
		} catch {
			return { ok: false, reason: "Invalid URL" };
		}

		const result = await deps.crawlArticle({ url });
		if (result.status !== "fetched") {
			return { ok: false, reason: "Could not fetch article" };
		}

		return parseHtml({ url, html: result.html, thumbnailUrl: result.thumbnailUrl ?? null });
	};

	return { parseArticle, parseHtml };
}

function tryExtractFromPreParsers(params: {
	preParsers: readonly SitePreParser[];
	hostname: string;
	html: string;
	url: string;
	logError: (message: string, error?: Error) => void;
}): SiteArticleContent | undefined {
	for (const preParser of params.preParsers) {
		try {
			if (!preParser.matches({ hostname: params.hostname })) continue;
			const extracted = preParser.extract({ html: params.html });
			if (extracted) return extracted;
		} catch (error) {
			params.logError(
				`[ReadabilityParser] Site pre-parser threw for ${params.url}`,
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}
	return undefined;
}

/* Wrap the pre-parser's extracted content in a minimal HTML document so
 * Readability has a clean, high-scoring `<article>` to pick from. The
 * title is set both in `<title>` (for Readability's title extraction) and
 * as an `<h1>` inside the article so Readability's heading heuristics
 * still work if the `<title>` is absent. Text fields are escaped so title
 * strings with HTML-significant characters don't break the document. */
function buildSyntheticHtml(extracted: SiteArticleContent): string {
	const escapedTitle = escapeHtmlText(extracted.title ?? "");
	const titleTag = extracted.title ? `<title>${escapedTitle}</title>` : "";
	const h1 = extracted.title ? `<h1>${escapedTitle}</h1>` : "";
	return `<!DOCTYPE html><html><head>${titleTag}</head><body><article>${h1}${extracted.bodyHtml}</article></body></html>`;
}

/* Re-home misplaced elements so the DOM matches what a spec-compliant
 * HTML5 parser would produce. linkedom doesn't implement the HTML5 tree
 * construction algorithm, so when the source HTML omits structural tags
 * it parks content in the wrong subtree:
 *   1. No <body> at all (hex.ooo shape) — flow content lands as a
 *      sibling of the synthetic empty <body>, under <html>.
 *   2. <head> opened but never closed (unplannedobsolescence.com shape)
 *      — flow content gets stuck inside <head>, with <body> empty.
 * Either way, Readability's _grabArticle walks parent chains expecting
 * to reach <body>, overshoots into the document node, and crashes with
 * "Cannot read properties of null (reading 'tagName')". See
 * mozilla/readability #435 and #757 — the upstream null-guard has not
 * shipped as of @mozilla/readability@0.6.0. */
function normalizeImplicitBody(document: Document): void {
	const head = document.head;
	const body = document.body;
	const METADATA_TAGS = new Set([
		"META",
		"LINK",
		"TITLE",
		"STYLE",
		"SCRIPT",
		"BASE",
	]);
	for (const child of Array.from(head.children)) {
		if (!METADATA_TAGS.has(child.tagName)) body.appendChild(child);
	}
	for (const child of Array.from(document.documentElement.children)) {
		if (child === head || child === body) continue;
		if (METADATA_TAGS.has(child.tagName)) head.appendChild(child);
		else body.appendChild(child);
	}
}

function escapeHtmlText(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

const VIDEO_PLACEHOLDER_LEAD = "Watch this video on ";
const VIDEO_PLACEHOLDER_TRAILING = " →";

function renderVideoPlaceholder(ctx: {
	document: Document;
	originalUrl: string;
	hostname: string;
}): Element {
	const placeholder = ctx.document.createElement("p");
	placeholder.setAttribute("class", "reader-video-placeholder");
	placeholder.appendChild(ctx.document.createTextNode(VIDEO_PLACEHOLDER_LEAD));
	const link = ctx.document.createElement("a");
	link.setAttribute("href", ctx.originalUrl);
	link.appendChild(ctx.document.createTextNode(ctx.hostname));
	placeholder.appendChild(link);
	placeholder.appendChild(ctx.document.createTextNode(VIDEO_PLACEHOLDER_TRAILING));
	return placeholder;
}
