import { z } from "zod";
import { escapeHtmlText } from "./pdf-html-helpers";

const FETCH_TIMEOUT_MS = 10_000;

const REDDIT_POST_URL = /^https?:\/\/(?:www\.|old\.)?reddit\.com\/r\/([A-Za-z0-9_]+)\/comments\/([a-z0-9]+)(?:[/?#].*)?$/;

const OembedPostSchema = z.object({ title: z.string().min(1), author_name: z.string().min(1), thumbnail_url: z.string().url().startsWith("https://").optional() });

export type RedditPostCard = { title: string; author: string; subreddit: string; excerpt: string; wordCount: number; postUrl: string; posterUrl: string | undefined; html: string };

export type FetchRedditPostCard = (params: { url: string }) => Promise<RedditPostCard | undefined>;

function postCardHtml(params: { postUrl: string; title: string; posterUrl: string | undefined }): string {
	const title = escapeHtmlText(params.title);
	const face = params.posterUrl === undefined ? title : `<img src="${escapeHtmlText(params.posterUrl)}" alt="${title}" loading="lazy">`;
	return `<p class="reader-embed-facade"><a href="${params.postUrl}" target="_blank" rel="noopener noreferrer">${face}</a></p>`;
}

export function initFetchRedditPostCard(deps: { fetch: typeof fetch; logError: (message: string, details?: { readonly error?: unknown }) => void }): FetchRedditPostCard {
	return async (params) => {
		const post = REDDIT_POST_URL.exec(params.url);
		if (post === null) return undefined;
		const [, subreddit, id] = post;
		const postUrl = `https://www.reddit.com/r/${subreddit}/comments/${id}/`;
		try {
			const response = await deps.fetch(`https://www.reddit.com/oembed?format=json&url=${encodeURIComponent(postUrl)}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
			if (!response.ok) {
				deps.logError(`[CrawlArticle] reddit oembed HTTP ${response.status} for ${params.url}`);
				return undefined;
			}
			const oembed = OembedPostSchema.safeParse(await response.json());
			if (!oembed.success) {
				deps.logError(`[CrawlArticle] reddit oembed payload rejected for ${params.url}`);
				return undefined;
			}
			const { title, author_name: author, thumbnail_url: posterUrl } = oembed.data;
			return {
				title,
				author,
				subreddit,
				excerpt: `Post by ${author} in r/${subreddit} on Reddit.`,
				wordCount: title.split(/\s+/).filter(Boolean).length,
				postUrl,
				posterUrl,
				html: postCardHtml({ postUrl, title, posterUrl }),
			};
		} catch (error) {
			deps.logError(`[CrawlArticle] reddit oembed error for ${params.url}`, { error });
			return undefined;
		}
	};
}
