import assert from "node:assert";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { articleFromHostTitle, clipMetadataExcerpt, contentSavedFromHostExcerpt, pageHostUrl } from "@packages/domain/article";
import { type YouTubeEmbed, escapeHtmlText } from "@packages/crawl-article";
import type { ParseHtml, ReadabilityAdditions } from "./article-parser.types";
import { matchingSiteRuleUrl, type SiteArticleContent, type SiteRules } from "@packages/site-rules";
import type {
	ActiveCoverageRules,
	CoverageAlternative,
	CoverageInspection,
	SourceInspection,
} from "./coverage-rules/coverage-rule.types";

export function initReadabilityParser(deps: {
	siteRules: readonly SiteRules[];
	readabilityAdditions: ReadabilityAdditions;
	coverageRules: ActiveCoverageRules;
	logError: (message: string, error?: Error) => void;
}): { parseHtml: ParseHtml } {
	const parseHtml: ParseHtml = (params) => {
		let hostname: string;
		try {
			new URL(params.url);
			hostname = pageHostUrl({ savedUrl: params.url, documentUrl: params.documentUrl }).hostname;
		} catch {
			return { ok: false, reason: "Invalid URL" };
		}
		const fallback = {
			title: articleFromHostTitle(hostname),
			siteName: hostname,
			excerpt: contentSavedFromHostExcerpt(hostname),
		};

		const html = deps.readabilityAdditions.normalizeMalformedTitleEndTag(params.html);
		const extracted = tryExtractFromSiteRules({
			siteRules: deps.siteRules,
			html,
			url: params.url,
			documentUrl: params.documentUrl,
			fetchedDocument: params.fetchedDocument,
			logError: deps.logError,
		});
		const inspected = extracted === undefined ? inspectCoverage({ html, documentUrl: params.documentUrl }) : [];

		const { document } = parseHTML(
			extracted ? buildSyntheticHtml(extracted) : html,
		);
		if (!document.documentElement) {
			return { ok: false, reason: "no <html> element in response body" };
		}
		// Any throw from normalization, Readability construction, or
		// Readability.parse() becomes a terminal parse failure so
		// the caller can mark the crawl failed immediately — otherwise
		// it escapes the whole pipeline and the reader slot is stuck on
		// "pending" until the dead-letter path ticks over.
		let restoreTitleHeading = (html: string) => html;
		let parsed: ReturnType<Readability["parse"]>;
		let phase: "Article normalization" | "Readability parse" = "Article normalization";
		try {
			deps.readabilityAdditions.normalizeImplicitBody(document);
			if (!extracted && html !== params.html) restoreTitleHeading = deps.readabilityAdditions.preserveQualifiedTitleHeading(document);
			deps.readabilityAdditions.preserveSubstackImagePreview({ document, savedUrl: params.url, documentUrl: params.documentUrl });
			deps.readabilityAdditions.unwrapArticleBodyTemplates(document);
			deps.readabilityAdditions.replaceVideosWithPlaceholder({
				document,
				originalUrl: params.url,
				renderPlaceholder: renderVideoPlaceholder,
			});
			deps.readabilityAdditions.replaceEmbedsWithFacade({ document, renderFacade: renderEmbedFacade });
			/* Site rules may mutate the document in place (e.g. LinkedIn
			 * rebuilding `\n\n` `white-space: pre-wrap` paragraphs) before
			 * Readability scores it. */
			applyTransforms({
				siteRules: deps.siteRules,
				document,
				url: params.url,
				documentUrl: params.documentUrl,
				logError: deps.logError,
			});
			deps.readabilityAdditions.demoteBodyHeadings(document);
			/* Promote inline `<br><br>` paragraph hosts to `<div>` before
			 * Readability runs, so its `_replaceBrs` + DIV phrasing-recovery
			 * rebuild the paragraphs instead of orphaning the leading line and
			 * nesting `<p>`s inside a phrasing `<span>` (the LinkedIn / Substack
			 * inline-post shape). */
			deps.readabilityAdditions.promoteBrParagraphHosts(document);
			phase = "Readability parse";
			/* `reader-video-placeholder` and `reader-embed-facade` join
			 * Readability's default `CLASSES_TO_PRESERVE` (concat'd internally) so
			 * the CSS hooks survive `_cleanClasses`; the <p> tag is also exempt
			 * from `_cleanConditionally`, and a <p> carrying an <img> survives
			 * empty-paragraph removal, keeping the link-bearing callout and the
			 * poster card from being dropped. */
			parsed = new Readability(document, {
				classesToPreserve: ["reader-video-placeholder", "reader-embed-facade"],
			}).parse();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { ok: false, reason: `${phase} failed: ${message}` };
		}

		if (!parsed) {
			return {
				ok: true,
				article: {
					...fallback,
					wordCount: 0,
					content: "",
					imageUrl: params.thumbnailUrl ?? undefined,
				},
				coverage: inspected.map((source) => toCoverageInspection({ source, url: params.url, documentUrl: params.documentUrl })),
			};
		}

		assert(parsed.textContent != null, "Readability provides textContent for parsed articles");
		assert(parsed.content != null, "Readability provides content for parsed articles");

		/* c8 ignore next 3 -- V8 block coverage phantom on object-literal start when followed by cascading `||` fallbacks (bcoe/c8#319, v8.dev/blog/javascript-code-coverage) */
		return {
			/* c8 ignore next 2 -- V8 block coverage phantom on the success-return object literal with cascading `||` fallbacks (bcoe/c8#319, v8.dev/blog/javascript-code-coverage) */
			ok: true,
			article: {
				title: parsed.title || fallback.title,
				siteName: parsed.siteName || fallback.siteName,
				excerpt: clipMetadataExcerpt(parsed.excerpt || fallback.excerpt),
				wordCount: Array.from(parsed.textContent.matchAll(/\S+/g)).length, /* c8 ignore next -- V8 block coverage phantom: zero-count sub-range at bytecode boundary (bcoe/c8#319, v8.dev/blog/javascript-code-coverage) */
				content: deps.readabilityAdditions.resolveRelativeUrls({ html: deps.readabilityAdditions.restoreRetaggedTables(restoreTitleHeading(parsed.content)), baseUrl: params.documentUrl }),
				imageUrl: params.thumbnailUrl ?? undefined,
				publishedOn: deps.readabilityAdditions.publishedOnFrom(parsed.publishedTime),
			},
			coverage: inspected.map((source) => toCoverageInspection({ source, url: params.url, documentUrl: params.documentUrl })),
		};
	};

	function inspectCoverage(source: { html: string; documentUrl: string }): readonly SourceInspection[] {
		try {
			return deps.coverageRules.inspect(source);
		} catch (error) {
			deps.logError(`[ReadabilityParser] Coverage inspection threw for ${source.documentUrl}`, toError(error));
			return [];
		}
	}

	function toCoverageInspection(params: { source: SourceInspection; url: string; documentUrl: string }): CoverageInspection {
		const { source } = params;
		if (source.kind === "abstained") {
			return source;
		}
		const { recoveredBodyHtml, verify, ...assessed } = source;
		return {
			...assessed,
			verify: (reader) => {
				try {
					return verify(reader);
				} catch (error) {
					deps.logError(`[ReadabilityParser] Coverage verify threw for ${params.documentUrl}`, toError(error));
					return { outcome: "unknown", reasons: ["rule-failed"] };
				}
			},
			alternative:
				recoveredBodyHtml === undefined
					? undefined
					: () => {
							try {
								return materialiseAlternative({ bodyHtml: recoveredBodyHtml, url: params.url, documentUrl: params.documentUrl });
							} catch (error) {
								deps.logError(`[ReadabilityParser] Coverage alternative threw for ${params.documentUrl}`, toError(error));
								return undefined;
							}
						},
		};
	}

	function materialiseAlternative(params: { bodyHtml: string; url: string; documentUrl: string }): CoverageAlternative {
		const { document } = parseHTML(`<!DOCTYPE html><html><head></head><body><article>${params.bodyHtml}</article></body></html>`);
		deps.readabilityAdditions.unwrapArticleBodyTemplates(document);
		deps.readabilityAdditions.replaceVideosWithPlaceholder({
			document,
			originalUrl: params.url,
			renderPlaceholder: renderVideoPlaceholder,
		});
		deps.readabilityAdditions.replaceEmbedsWithFacade({ document, renderFacade: renderEmbedFacade });
		applyTransforms({
			siteRules: deps.siteRules,
			document,
			url: params.url,
			documentUrl: params.documentUrl,
			logError: deps.logError,
		});
		deps.readabilityAdditions.demoteBodyHeadings(document);
		const article = document.querySelector("article");
		assert(article, "the alternative document is built around an <article>");
		const text = article.textContent;
		assert(text !== null, "an element always has textContent");
		return {
			content: deps.readabilityAdditions.resolveRelativeUrls({
				html: deps.readabilityAdditions.restoreRetaggedTables(article.innerHTML),
				baseUrl: params.documentUrl,
			}),
			wordCount: Array.from(text.matchAll(/\S+/g)).length,
		};
	}

	return { parseHtml };
}

function tryExtractFromSiteRules(params: {
	siteRules: readonly SiteRules[];
	html: string;
	url: string;
	documentUrl: string;
	fetchedDocument?: true;
	logError: (message: string, error?: Error) => void;
}): SiteArticleContent | undefined {
	for (const site of params.siteRules) {
		try {
			const url = site.matchFetchedDocument ? params.fetchedDocument && params.documentUrl : params.url;
			if (url === undefined || matchingSiteRuleUrl({ site, url }) === undefined) continue;
			const extracted = site.extract({ html: params.html }, { savedUrl: params.url, documentUrl: params.documentUrl });
			if (extracted) return extracted;
		} catch (error) {
			params.logError(
				`[ReadabilityParser] Site extract threw for ${params.url}`,
				toError(error),
			);
		}
	}
	return undefined;
}

/* Run every matching site rule's in-place `transform` against the parsed
 * document before the default parser scores it. A transform that throws is
 * logged and swallowed so a faulty site-specific tweak can never drop the
 * article — the document is left as it was and Readability still scores it. */
function applyTransforms(params: {
	siteRules: readonly SiteRules[];
	document: Document;
	url: string;
	documentUrl: string;
	logError: (message: string, error?: Error) => void;
}): void {
	for (const site of params.siteRules) {
		if (matchingSiteRuleUrl({ site, url: params.url }) === undefined) continue;
		try {
			site.transform({ document: params.document }, { savedUrl: params.url, documentUrl: params.documentUrl });
		} catch (error) {
			params.logError(
				`[ReadabilityParser] Site transform threw for ${params.url}`,
				toError(error),
			);
		}
	}
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

/* Wrap the site rule's extracted content in a minimal HTML document so
 * Readability has a clean, high-scoring `<article>` to pick from. The
 * title is set both in `<title>` (for Readability's title extraction) and
 * as an `<h1>` inside the article so Readability's heading heuristics
 * still work if the `<title>` is absent. Text fields are escaped so title
 * strings with HTML-significant characters don't break the document. */
function buildSyntheticHtml(extracted: SiteArticleContent): string {
	const escapedTitle = escapeHtmlText(extracted.title ?? "");
	const titleTag = extracted.title ? `<title>${escapedTitle}</title>` : "";
	const h1 = extracted.title ? `<h1>${escapedTitle}</h1>` : "";
	const descriptionTag = extracted.excerpt ? `<meta name="description" content="${escapeHtmlText(extracted.excerpt)}">` : "";
	const siteNameTag = extracted.siteName ? `<meta property="og:site_name" content="${escapeHtmlText(extracted.siteName)}">` : "";
	return `<!DOCTYPE html><html><head>${titleTag}${descriptionTag}${siteNameTag}</head><body><article>${h1}${extracted.bodyHtml}</article></body></html>`;
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

const EMBED_PLAYLIST_LEAD = "Watch this playlist on ";
const EMBED_PLAYLIST_LABEL = "YouTube";
const EMBED_PLAYLIST_TRAILING = " →";

function renderEmbedFacade(ctx: {
	document: Document;
	embed: YouTubeEmbed;
}): Element {
	const link = ctx.document.createElement("a");
	link.setAttribute("href", ctx.embed.watchUrl);
	link.setAttribute("target", "_blank");
	link.setAttribute("rel", "noopener noreferrer");
	if (ctx.embed.kind === "playlist") {
		/* A playlist embed has no single-video thumbnail to rehost, so it can't
		 * become a poster card; reuse the native-<video> text callout instead so
		 * the link still survives Readability's empty-<p> prune (it carries text
		 * rather than an <img>). */
		const callout = ctx.document.createElement("p");
		callout.setAttribute("class", "reader-video-placeholder");
		callout.appendChild(ctx.document.createTextNode(EMBED_PLAYLIST_LEAD));
		link.appendChild(ctx.document.createTextNode(EMBED_PLAYLIST_LABEL));
		callout.appendChild(link);
		callout.appendChild(ctx.document.createTextNode(EMBED_PLAYLIST_TRAILING));
		return callout;
	}
	const wrapper = ctx.document.createElement("p");
	wrapper.setAttribute("class", "reader-embed-facade");
	const poster = ctx.document.createElement("img");
	poster.setAttribute("src", ctx.embed.posterUrl);
	poster.setAttribute("alt", "Watch on YouTube");
	poster.setAttribute("loading", "lazy");
	link.appendChild(poster);
	wrapper.appendChild(link);
	return wrapper;
}
