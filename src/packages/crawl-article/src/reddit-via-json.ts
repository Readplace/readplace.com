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
 * Convert a Reddit /r/<sub>/comments/<id>/<slug>/ URL into its `.json` API
 * sibling. Reddit serves the post + comments tree from `.json` as a flat
 * JSON response; the response shape is the same on every reddit.com host.
 * Strip search params — share_id and utm_* are tracking, not required for
 * the API, and they reduce edge cache effectiveness if left on.
 */
export function toRedditJsonUrl(url: string): string {
	const u = new URL(url);
	u.pathname = u.pathname.replace(/\/?$/, ".json");
	u.search = "";
	return u.href;
}

type RedditChild = {
	readonly data: {
		readonly title?: unknown;
		readonly selftext_html?: unknown;
		readonly selftext?: unknown;
		readonly url_overridden_by_dest?: unknown;
		readonly url?: unknown;
		readonly author?: unknown;
		readonly subreddit?: unknown;
		readonly preview?: unknown;
	};
};

type RedditListing = {
	readonly data?: { readonly children?: readonly RedditChild[] };
};

/**
 * Reddit's article pages 403 from AWS Lambda's outbound egress on every host
 * we have access to (www, old, np, m) — IP-based and regardless of TLS
 * fingerprint. Reddit's per-post JSON API endpoint, however, is the data
 * source for their own iOS/Android apps and is served with much laxer edge
 * rules; from Lambda we can fetch it cleanly without an external proxy.
 *
 * The handler short-circuits the normal crawl path when given a Reddit
 * /comments/ URL: fetch the .json sibling, walk the post listing, and emit
 * a synthetic HTML body that Readability can extract. Anything outside the
 * /comments/ shape (subreddit fronts, user pages, /s/ shortlinks) is not
 * supported — return "unsupported" so the caller can decide how to surface
 * it.
 */
export function initFetchRedditViaJson(deps: {
	crawlFetch: CrawlFetch;
	logError: (message: string, error?: Error) => void;
}): (params: { url: string }) => Promise<CrawlArticleResult> {
	const { crawlFetch, logError } = deps;
	return async (params) => {
		const jsonUrl = toRedditJsonUrl(params.url);
		try {
			const response = await crawlFetch(jsonUrl, {
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
				headers: { accept: "application/json" },
			});
			if (!response.ok) {
				logError(`[CrawlArticle] Reddit-via-json HTTP ${response.status} for ${jsonUrl}`);
				return { status: "failed" };
			}
			const raw = (await response.json()) as unknown;
			const post = extractPost(raw);
			if (!post) {
				logError(`[CrawlArticle] Reddit-via-json missing post data for ${jsonUrl}`);
				return { status: "failed" };
			}
			const html = renderPostAsHtml(post);
			const result: CrawlArticleResult & { status: "fetched" } = { status: "fetched", html };
			const thumbnailUrl = extractThumbnailUrl(post);
			if (thumbnailUrl) result.thumbnailUrl = thumbnailUrl;
			return result;
		} catch (error) {
			logError(
				`[CrawlArticle] Reddit-via-json error for ${jsonUrl}`,
				error instanceof Error ? error : undefined,
			);
			return { status: "failed" };
		}
	};
}

type Post = {
	title: string;
	bodyHtml: string;
	author: string;
	subreddit: string;
	linkedUrl: string | undefined;
	thumbnailUrl: string | undefined;
};

function extractPost(raw: unknown): Post | null {
	if (!Array.isArray(raw) || raw.length === 0) return null;
	const listing = raw[0] as RedditListing;
	const child = listing.data?.children?.[0];
	if (!child) return null;
	const data = child.data;
	const title = stringOrEmpty(data.title);
	if (!title) return null;
	return {
		title,
		bodyHtml: htmlSelftext(data),
		author: stringOrEmpty(data.author),
		subreddit: stringOrEmpty(data.subreddit),
		linkedUrl: stringOrUndefined(data.url_overridden_by_dest) ?? stringOrUndefined(data.url),
		thumbnailUrl: extractPreviewImage(data.preview),
	};
}

function htmlSelftext(data: RedditChild["data"]): string {
	const html = stringOrUndefined(data.selftext_html);
	if (html) return decodeRedditHtmlEntities(html);
	const text = stringOrEmpty(data.selftext);
	if (!text) return "";
	return text
		.split(/\n{2,}/)
		.map((paragraph) => `<p>${escapeHtmlText(paragraph)}</p>`)
		.join("\n");
}

function renderPostAsHtml(post: Post): string {
	const subredditLine = post.subreddit
		? `<p><em>r/${escapeHtmlText(post.subreddit)}${post.author ? ` · u/${escapeHtmlText(post.author)}` : ""}</em></p>`
		: "";
	const linkedSection = post.linkedUrl
		? `<p><a href="${escapeHtmlText(post.linkedUrl)}">${escapeHtmlText(post.linkedUrl)}</a></p>`
		: "";
	return [
		"<!DOCTYPE html>",
		"<html><head>",
		`<title>${escapeHtmlText(post.title)}</title>`,
		"</head><body>",
		"<article>",
		`<h1>${escapeHtmlText(post.title)}</h1>`,
		subredditLine,
		linkedSection,
		post.bodyHtml,
		"</article>",
		"</body></html>",
	].filter(Boolean).join("\n");
}

function extractPreviewImage(preview: unknown): string | undefined {
	if (!preview || typeof preview !== "object") return undefined;
	const images = (preview as { images?: unknown }).images;
	if (!Array.isArray(images) || images.length === 0) return undefined;
	const first = images[0];
	if (!first || typeof first !== "object") return undefined;
	const source = (first as { source?: unknown }).source;
	if (!source || typeof source !== "object") return undefined;
	const url = (source as { url?: unknown }).url;
	if (typeof url !== "string" || !url) return undefined;
	return decodeRedditHtmlEntities(url);
}

function extractThumbnailUrl(post: Post): string | undefined {
	return post.thumbnailUrl;
}

function stringOrEmpty(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function stringOrUndefined(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Reddit double-encodes HTML entities in selftext_html and preview URLs. */
function decodeRedditHtmlEntities(input: string): string {
	return input
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");
}
