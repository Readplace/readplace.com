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

export type ParseHtml = (params: { url: string; html: string; thumbnailUrl?: string }) => ParseArticleResult;

/* Structured content extracted by a site pre-parser. Intentionally
 * parser-agnostic — bodyHtml is a plain HTML string; it is up to the
 * consuming parser (Readability today, potentially LLM-based or other
 * strategies in the future) to decide how to adapt this into its own
 * input. */
export type SiteArticleContent = {
	title?: string;
	bodyHtml: string;
};

/* Pre-parser for sites whose article body is not in the DOM as normal
 * markup (e.g. paywalled content rendered client-side from a JSON island).
 *
 * The pre-parser is responsible for locating the content in whatever
 * site-specific way it needs (parsing the HTML, reading a JSON island,
 * calling out to an API) and returning a `SiteArticleContent` payload.
 * It returns `undefined` when the expected content shape is not present,
 * letting the parser fall back to its default extraction strategy.
 *
 * Open for extension: add a new site by writing a new module exporting a
 * `SitePreParser` and registering it at the composition root. The parser
 * itself is closed for modification, and pre-parsers are not coupled to
 * any particular downstream parsing strategy. */
export type SitePreParser = {
	matches: (params: { hostname: string }) => boolean;
	extract: (params: { html: string }) => SiteArticleContent | undefined;
};
