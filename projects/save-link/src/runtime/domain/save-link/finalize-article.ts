import { createHash } from "node:crypto";
import type { ParseHtml } from "@packages/article-parser";
import {
	extractThumbnailCandidates,
	type FetchThumbnailImage,
	type ThumbnailImage,
} from "@packages/crawl-article";
import type { PutImageObject } from "../../providers/article-store/s3-put-image-object";
import { ArticleResourceUniqueId } from "./article-resource-unique-id";
import type { DownloadMedia, DownloadedMedia } from "./download-media";
import { estimatedReadTimeFromWordCount } from "./estimated-read-time";

export type ProcessContent = (params: { html: string; media: DownloadedMedia[] }) => Promise<string>;

export type FinalizedArticle = {
	/** Processed body HTML with media URLs rewritten to the CDN. */
	html: string;
	metadata: {
		title: string;
		siteName: string;
		excerpt: string;
		wordCount: number;
		estimatedReadTime: number;
		imageUrl?: string;
	};
};

export type FinalizeArticleResult =
	| { ok: true; article: FinalizedArticle }
	| { ok: false; reason: string };

export type FinalizeArticle = (input: {
	url: string;
	html: string;
	/** Image bytes that the crawler already fetched inline (SimpleCrawl with
	 * `fetchThumbnail: true`). When present, skip the re-fetch and just upload.
	 * When absent (raw-HTML save, comprehensive crawl), the finalizer fetches
	 * the cascade of og:image / twitter:image / first-<img> candidates itself. */
	preFetchedThumbnail?: ThumbnailImage;
}) => Promise<FinalizeArticleResult>;

/**
 * The single source of truth for turning a raw HTML body into the canonical
 * `{ html, metadata }` pair that gets persisted as a tier source. Every path
 * that produces an article representation routes through here: SimpleCrawl
 * save / recrawl, ComprehensiveCrawl PDF, stale-check refresh, browser-extension
 * raw-HTML save, dev in-memory wrappers. Steps run in the same order for every
 * caller — parseHtml → downloadMedia → processContent → fetch og:image (if not
 * pre-fetched) → uploadThumbnail — so the resulting metadata.imageUrl always
 * either points to the Readplace CDN (image fetch succeeded) or falls back to
 * the raw og:image URL (image fetch failed), never silently goes missing.
 */
export function initFinalizeArticle(deps: {
	parseHtml: ParseHtml;
	downloadMedia: DownloadMedia;
	processContent: ProcessContent;
	fetchThumbnailImage: FetchThumbnailImage;
	putImageObject: PutImageObject;
	imagesCdnBaseUrl: string;
}): FinalizeArticle {
	const {
		parseHtml,
		downloadMedia,
		processContent,
		fetchThumbnailImage,
		putImageObject,
		imagesCdnBaseUrl,
	} = deps;

	return async (input) => {
		/* Two-pass HTML parse is intentional: extractThumbnailCandidates uses
		 * linkedom for og:image / meta-tag extraction, while parseHtml uses
		 * Readability for content extraction — different libraries, different
		 * concerns, negligible overhead on article-sized documents. */
		const candidates = extractThumbnailCandidates({ html: input.html, baseUrl: input.url });
		const thumbnailUrl = candidates[0] ?? null;

		const parseResult = parseHtml({
			url: input.url,
			html: input.html,
			thumbnailUrl,
		});
		if (!parseResult.ok) return { ok: false, reason: parseResult.reason };

		const { article } = parseResult;
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(input.url);

		const media = await downloadMedia({
			html: article.content,
			articleUrl: input.url,
			articleResourceUniqueId,
		});
		const html = await processContent({ html: article.content, media });

		const thumbnailImage =
			input.preFetchedThumbnail
			?? (await fetchThumbnailImage({ candidates, referer: input.url }));

		const imageUrl = thumbnailImage
			? await uploadThumbnail({
					thumbnailImage,
					articleResourceUniqueId,
					putImageObject,
					imagesCdnBaseUrl,
				})
			: article.imageUrl;

		return {
			ok: true,
			article: {
				html,
				metadata: {
					title: article.title,
					siteName: article.siteName,
					excerpt: article.excerpt,
					wordCount: article.wordCount,
					estimatedReadTime: estimatedReadTimeFromWordCount(article.wordCount),
					imageUrl,
				},
			},
		};
	};
}

async function uploadThumbnail(args: {
	thumbnailImage: ThumbnailImage;
	articleResourceUniqueId: ArticleResourceUniqueId;
	putImageObject: PutImageObject;
	imagesCdnBaseUrl: string;
}): Promise<string> {
	const { thumbnailImage, articleResourceUniqueId, putImageObject, imagesCdnBaseUrl } = args;
	const hash = createHash("sha256").update(thumbnailImage.url).digest("hex").slice(0, 16);
	const filename = `${hash}${thumbnailImage.extension}`;
	const key = articleResourceUniqueId.toS3ImageKey(filename);
	await putImageObject({ key, body: thumbnailImage.body, contentType: thumbnailImage.contentType });
	return articleResourceUniqueId.toImageCdnUrl({ baseUrl: imagesCdnBaseUrl, filename });
}
