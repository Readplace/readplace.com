import type { CrawlArticleResult } from "./crawl-article.types";
import type { CrawlFetch } from "./crawl-fetch";

const FETCH_TIMEOUT_MS = 10000;
const X_TWITTER_PATTERN = /^https?:\/\/(x\.com|twitter\.com)\//;
const TWEET_STATUS_PATH = /^(\/[^/]+\/status\/\d+)/;

export function isTweetUrl(url: string): boolean {
	return X_TWITTER_PATTERN.test(url);
}

/** Twitter's oembed endpoint 404s on any tweet URL carrying a sub-path like
 * `/video/<n>`, `/photo/<n>`, `/analytics`, `/likes`, `/retweets`, `/quotes`.
 * Canonicalise to `<origin>/<handle>/status/<id>` so those forms still resolve. */
function canonicaliseTweetUrl(raw: string): string {
	try {
		const u = new URL(raw);
		const match = u.pathname.match(TWEET_STATUS_PATH);
		return match ? `${u.origin}${match[1]}` : raw;
	} catch {
		return raw;
	}
}

/** X/Twitter returns a JS app shell with no content. The oembed API returns the actual tweet text. */
export function initFetchTweetViaOembed(deps: {
	crawlFetch: CrawlFetch;
	logError: (message: string, error?: Error) => void;
}): (params: { url: string }) => Promise<CrawlArticleResult> {
	const { crawlFetch, logError } = deps;
	return async (params) => {
		const canonicalUrl = canonicaliseTweetUrl(params.url);
		const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(canonicalUrl)}`;
		try {
			const response = await crawlFetch(oembedUrl, {
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});
			if (!response.ok) {
				logError(`[CrawlArticle] oembed HTTP ${response.status} for ${params.url}`);
				return { status: "failed" };
			}
			const data = await response.json() as Record<string, unknown>;
			const authorName = typeof data.author_name === "string" ? data.author_name : "";
			const embed = typeof data.html === "string" ? data.html : "";
			const html = `<html><head><title>${authorName}</title></head><body>${embed}</body></html>`;
			return { status: "fetched", html };
		} catch (error) {
			logError(`[CrawlArticle] oembed error for ${params.url}`, error instanceof Error ? error : undefined);
			return { status: "failed" };
		}
	};
}
