import { z } from "zod";
import { noExtract, noTransform } from "@packages/site-rules";
import type { SiteRules } from "@packages/site-rules";
import type { CrawlFetch } from "./crawl-fetch";

const FETCH_TIMEOUT_MS = 10000;

const OembedResponse = z
	.object({
		author_name: z.string().catch(""),
		html: z.string().catch(""),
	})
	.catch({ author_name: "", html: "" });
const X_TWITTER_PATTERN = /^https?:\/\/(x\.com|twitter\.com)\//;
const TWEET_STATUS_PATH = /^(\/[^/]+\/status\/\d+)/;

function isTweetUrl(url: string): boolean {
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

/** X/Twitter returns a JS app shell with no content, so a normal fetch only
 * captures the shell. This site replaces the crawl with Twitter's oembed API,
 * which returns the actual tweet text. It fails closed on an oembed error
 * rather than declining, so the caller never falls back to fetching the shell. */
export function initXTwitterSiteRules(deps: {
	crawlFetch: CrawlFetch;
	logError: (message: string, error?: Error) => void;
}): SiteRules {
	const { crawlFetch, logError } = deps;
	const onCrawl: SiteRules["onCrawl"] = async (params) => {
		const canonicalUrl = canonicaliseTweetUrl(params.url);
		const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(canonicalUrl)}`;
		try {
			const response = await crawlFetch(oembedUrl, { budgetMs: FETCH_TIMEOUT_MS });
			if (!response.ok) {
				logError(`[CrawlArticle] oembed HTTP ${response.status} for ${params.url}`);
				return { kind: "failed" };
			}
			const text = await response.text();
			const { author_name: authorName, html: embed } = OembedResponse.parse(JSON.parse(text));
			const html = `<html><head><title>${authorName}</title></head><body>${embed}</body></html>`;
			return { kind: "content", html };
		} catch (error) {
			logError(`[CrawlArticle] oembed error for ${params.url}`, error instanceof Error ? error : undefined);
			return { kind: "failed" };
		}
	};

	return {
		matches: ({ url }) => isTweetUrl(url),
		onCrawl,
		extract: noExtract,
		transform: noTransform,
	};
}
