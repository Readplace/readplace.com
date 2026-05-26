import { escapeHtmlText } from "./pdf-html-helpers";
import type { CrawlArticleResult } from "./crawl-article.types";
import type { CrawlFetch } from "./crawl-fetch";

const REDDIT_WEB_HOSTS: ReadonlySet<string> = new Set([
	"www.reddit.com",
	"m.reddit.com",
	"np.reddit.com",
	"old.reddit.com",
	"reddit.com",
]);

const COMMENTS_PATH = /^\/r\/[^/]+\/comments\/[^/]+(?:\/[^/]*)?\/?$/;

const FETCH_TIMEOUT_MS = 10000;

export function isRedditCommentsUrl(url: string): boolean {
	try {
		const u = new URL(url);
		return REDDIT_WEB_HOSTS.has(u.hostname) && COMMENTS_PATH.test(u.pathname);
	} catch {
		return false;
	}
}

/**
 * Canonicalise a Reddit /comments/ URL for the oEmbed endpoint. Strip
 * share_id/utm_* tracking params and normalise the host to www.reddit.com
 * (the oEmbed endpoint only accepts www).
 */
export function toOembedSubjectUrl(url: string): string {
	const u = new URL(url);
	u.hostname = "www.reddit.com";
	u.search = "";
	return u.href;
}

/**
 * Reddit's article pages and .json API 403 from AWS Lambda's outbound egress
 * on every host (www, old, np, m) — IP-based, regardless of TLS fingerprint.
 * Reddit's oEmbed endpoint (https://www.reddit.com/oembed) is served from a
 * different edge that does not apply the same IP-based filtering.
 *
 * The handler short-circuits the normal crawl path when given a Reddit
 * /comments/ URL: fetch the oEmbed response and wrap the embed HTML in a
 * synthetic document. Same pattern as X/Twitter oembed.
 */
export function initFetchRedditViaOembed(deps: {
	crawlFetch: CrawlFetch;
	logError: (message: string, error?: Error) => void;
}): (params: { url: string }) => Promise<CrawlArticleResult> {
	const { crawlFetch, logError } = deps;
	return async (params) => {
		const subjectUrl = toOembedSubjectUrl(params.url);
		const oembedUrl = `https://www.reddit.com/oembed?url=${encodeURIComponent(subjectUrl)}`;
		try {
			const response = await crawlFetch(oembedUrl, {
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
				headers: { accept: "application/json" },
			});
			if (!response.ok) {
				logError(`[CrawlArticle] Reddit oembed HTTP ${response.status} for ${params.url}`);
				return { status: "failed" };
			}
			const data = (await response.json()) as Record<string, unknown>;
			const title = typeof data.title === "string" ? data.title : "";
			const authorName = typeof data.author_name === "string" ? data.author_name : "";
			const embed = typeof data.html === "string" ? data.html : "";
			if (!title && !embed) {
				logError(`[CrawlArticle] Reddit oembed empty response for ${params.url}`);
				return { status: "failed" };
			}
			const heading = title ? `<h1>${escapeHtmlText(title)}</h1>` : "";
			const authorLine = authorName ? `<p><em>u/${escapeHtmlText(authorName)}</em></p>` : "";
			const html = [
				"<!DOCTYPE html>",
				`<html><head><title>${escapeHtmlText(title)}</title></head><body>`,
				"<article>",
				heading,
				authorLine,
				embed,
				"</article>",
				"</body></html>",
			].join("\n");
			return { status: "fetched", html };
		} catch (error) {
			logError(
				`[CrawlArticle] Reddit oembed error for ${params.url}`,
				error instanceof Error ? error : undefined,
			);
			return { status: "failed" };
		}
	};
}
