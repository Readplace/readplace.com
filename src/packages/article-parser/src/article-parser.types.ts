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
 * The parser does not parse the HTML for an image, so callers must
 * extract thumbnail candidates from the source HTML and pick one (or
 * pass `null` to deliberately opt out). */
export type ParseHtml = (params: {
	url: string;
	documentUrl: string;
	html: string;
	thumbnailUrl: string | null;
}) => ParseArticleResult;
