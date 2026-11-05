import assert from "node:assert";
import { parseHTML } from "linkedom";
import { z } from "zod";
import { noExtract, noRecovery, noTransform } from "@packages/site-rules";
import type { SiteRules } from "@packages/site-rules";
import { HONEST_BOT_HEADERS } from "./crawl-article";
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
const ARTICLE_PATH = /^\/i\/article\/\d+/;

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

function isXArticleUrl(url: string): boolean {
	return isTweetUrl(url) && ARTICLE_PATH.test(new URL(url).pathname);
}

function coverLinkCandidates(syntheticHtml: string): string[] {
	const { document } = parseHTML(syntheticHtml);
	const paragraph = document.querySelector("blockquote p");
	if (!paragraph) return [];
	const isLinkOnly = [...paragraph.childNodes].every(
		(node) => node.nodeName === "A" || (node.nodeName === "#text" && node.textContent.trim() === ""),
	);
	if (!isLinkOnly) return [];
	return [...paragraph.querySelectorAll("a[href]")].map((anchor): string => {
		const href = anchor.getAttribute("href");
		assert(href !== null, "a[href] matched an anchor without an href");
		return href;
	}).filter((href) => URL.canParse(href) && new URL(href).hostname === "t.co");
}

async function firstRedirectHopOf(deps: { crawlFetch: CrawlFetch; url: string }): Promise<string | undefined> {
	const controller = new AbortController();
	let target: string | undefined;
	try {
		const response = await deps.crawlFetch(deps.url, {
			budgetMs: FETCH_TIMEOUT_MS,
			headers: HONEST_BOT_HEADERS,
			signal: controller.signal,
			onRedirect: ({ toUrl }) => {
				target = toUrl;
				controller.abort();
			},
		});
		await response.body?.cancel();
		return target;
	} catch {
		return target;
	}
}

function skippingArticleCovers(deps: {
	crawlFetch: CrawlFetch;
	oembedCrawl: SiteRules["onCrawl"];
}): SiteRules["onCrawl"] {
	return async (params) => {
		const outcome = await deps.oembedCrawl(params);
		if (outcome.kind !== "content") return outcome;
		for (const url of coverLinkCandidates(outcome.html)) {
			const hop = await firstRedirectHopOf({ crawlFetch: deps.crawlFetch, url });
			if (hop !== undefined && isXArticleUrl(hop)) return { kind: "skip" };
		}
		return outcome;
	};
}

/** This site replaces the crawl with Twitter's oembed API, which returns the
 * actual tweet text. It fails closed on an oembed error rather than declining. */
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
		onCrawl: skippingArticleCovers({ crawlFetch, oembedCrawl: onCrawl }),
		recoverContent: noRecovery,
		extract: noExtract,
		transform: noTransform,
	};
}
