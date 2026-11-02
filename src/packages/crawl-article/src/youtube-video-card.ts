import { z } from "zod";
import { parseYouTubeEmbed } from "./parse-embed-url";

const FETCH_TIMEOUT_MS = 10_000;

const OembedVideoSchema = z.object({ title: z.string().min(1), author_name: z.string().min(1) });

export type YouTubeVideoCard = { title: string; author: string; excerpt: string; watchUrl: string; posterUrl: string; html: string };

export type FetchYouTubeVideoCard = (params: { url: string }) => Promise<YouTubeVideoCard | undefined>;

export function initFetchYouTubeVideoCard(deps: { fetch: typeof fetch; logError: (message: string, error?: Error) => void }): FetchYouTubeVideoCard {
	return async (params) => {
		const embed = parseYouTubeEmbed(params.url);
		if (embed?.kind !== "video") return undefined;
		const { watchUrl, posterUrl } = embed;
		try {
			const response = await deps.fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl)}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
			if (!response.ok) {
				deps.logError(`[CrawlArticle] youtube oembed HTTP ${response.status} for ${params.url}`);
				return undefined;
			}
			const video = OembedVideoSchema.safeParse(await response.json());
			if (!video.success) {
				deps.logError(`[CrawlArticle] youtube oembed payload rejected for ${params.url}`);
				return undefined;
			}
			const { title, author_name: author } = video.data;
			return {
				title,
				author,
				excerpt: `Video by ${author} on YouTube.`,
				watchUrl,
				posterUrl,
				html: `<p class="reader-embed-facade"><a href="${watchUrl}" target="_blank" rel="noopener noreferrer"><img src="${posterUrl}" alt="Watch on YouTube" loading="lazy"></a></p>`,
			};
		} catch (error) {
			deps.logError(`[CrawlArticle] youtube oembed error for ${params.url}`, error instanceof Error ? error : undefined);
			return undefined;
		}
	};
}
