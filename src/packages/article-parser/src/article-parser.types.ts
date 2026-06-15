interface ParsedArticle {
	title: string;
	siteName: string;
	excerpt: string;
	wordCount: number;
	content: string;
	imageUrl?: string;
}

export type ParseArticleResult =
	| { ok: true; article: ParsedArticle }
	| { ok: false; reason: string };

export type ParseArticle = (url: string) => Promise<ParseArticleResult>;

/* `thumbnailUrl` is intentionally REQUIRED (string | null) — every caller
 * must make an explicit thumbnail decision so different entry points
 * (server-side crawl, browser-extension raw HTML, stale-check refresh)
 * cannot silently disagree on whether og:image landed in the metadata.
 * Use `extractThumbnailCandidates` from `@packages/crawl-article` on the
 * source HTML and pick the first entry (or pass `null` to deliberately
 * opt out). The parser itself does not parse the HTML for an image. */
export type ParseHtml = (params: { url: string; html: string; thumbnailUrl: string | null }) => ParseArticleResult;

/* Structured content extracted by a site pre-parser. Intentionally
 * parser-agnostic — bodyHtml is a plain HTML string; it is up to the
 * consuming parser (Readability today, potentially LLM-based or other
 * strategies in the future) to decide how to adapt this into its own
 * input. */
export type SiteArticleContent = {
	title?: string;
	bodyHtml: string;
};

/* Site-specific hook applied before the default parser runs, in one of two
 * shapes (a pre-parser provides whichever fits the site):
 *
 *   - `extract` REPLACES the document with site content the default parser
 *     could not reach (e.g. a paywalled body read from a JSON island). The
 *     first matching `extract` that returns a result wins; the rest of the
 *     page is discarded. Returns `undefined` to fall through.
 *   - `transform` MUTATES the parsed document in place (e.g. rebuilding a
 *     post's `\n\n` paragraph structure). Unlike `extract`, the whole page
 *     survives, so the default parser still scores it and picks the real
 *     article body — the right choice when the site-specific shape can't be
 *     isolated from page chrome without that scoring.
 *
 * Open for extension: add a new site by writing a new module exporting a
 * `SitePreParser` and registering it at the composition root. The parser
 * itself is closed for modification, and pre-parsers are not coupled to
 * any particular downstream parsing strategy. */
export type SitePreParser = {
	matches: (params: { hostname: string }) => boolean;
	extract?: (params: { html: string }) => SiteArticleContent | undefined;
	transform?: (params: { document: Document }) => void;
};
