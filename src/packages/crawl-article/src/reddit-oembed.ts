import type { CrawlArticleResult } from "./crawl-article.types";
import type { CrawlFetch } from "./crawl-fetch";

const FETCH_TIMEOUT_MS = 10000;

const REDDIT_WEB_HOSTS: ReadonlySet<string> = new Set([
	"www.reddit.com",
	"m.reddit.com",
	"np.reddit.com",
	"reddit.com",
	"old.reddit.com",
]);

export function isRedditUrl(url: string): boolean {
	try {
		return REDDIT_WEB_HOSTS.has(new URL(url).hostname);
	} catch {
		return false;
	}
}

/**
 * www.reddit.com and old.reddit.com both 403 crawler-shaped traffic from
 * AWS Lambda / datacenter IPs (`server: snooserv`, network-policy block).
 * Reddit's oEmbed endpoint (`https://www.reddit.com/oembed`) is not behind
 * the same IP block and returns the post title + a blockquote embed — enough
 * for Readability to extract a meaningful article body.
 *
 * Same pattern as initFetchTweetViaOembed (x-twitter-preprocessor.ts).
 */
export function initFetchRedditViaOembed(deps: {
	crawlFetch: CrawlFetch;
	logError: (message: string, error?: Error) => void;
}): (params: { url: string }) => Promise<CrawlArticleResult> {
	const { crawlFetch, logError } = deps;
	return async (params) => {
		const canonicalUrl = toWwwReddit(params.url);
		const oembedUrl = `https://www.reddit.com/oembed?url=${encodeURIComponent(canonicalUrl)}`;
		try {
			const response = await crawlFetch(oembedUrl, {
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});
			if (!response.ok) {
				logError(`[CrawlArticle] Reddit oembed HTTP ${response.status} for ${params.url}`);
				return { status: "failed" };
			}
			const data = (await response.json()) as Record<string, unknown>;
			const title = typeof data.title === "string" ? data.title : "";
			const authorName = typeof data.author_name === "string" ? data.author_name : "";
			const embed = typeof data.html === "string" ? data.html : "";
			const html = `<html><head><title>${escapeHtml(title)}</title></head><body><p>by ${escapeHtml(authorName)}</p>${embed}</body></html>`;
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

/**
 * Normalise any Reddit host variant to www.reddit.com so the oEmbed
 * endpoint receives a canonical URL it recognises.
 *
 * Only called after isRedditUrl() confirms the URL parses successfully.
 */
function toWwwReddit(url: string): string {
	const parsed = new URL(url);
	if (REDDIT_WEB_HOSTS.has(parsed.hostname)) {
		parsed.hostname = "www.reddit.com";
	}
	return parsed.href;
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
