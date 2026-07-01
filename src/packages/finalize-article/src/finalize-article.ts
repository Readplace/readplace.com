import { createHash } from "node:crypto";
import type { ParseHtml } from "@packages/article-parser";
import {
	escapeHtmlText,
	extractThumbnailCandidates,
	type FetchThumbnailImage,
	type ThumbnailImage,
} from "@packages/crawl-article";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { DownloadMedia, DownloadedMedia } from "./download-media.types";
import type { PutImageObject } from "./put-image-object.types";
import { estimatedReadTimeFromWordCount } from "./estimated-read-time";
import { isBareImageCapture } from "./is-bare-image-capture";
import { resolveCanonicalUrl } from "./resolve-canonical-url";
import { stripOversizedInlineImages } from "./strip-inline-image-data";

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
	| { ok: true; article: FinalizedArticle; canonicalUrl?: string }
	| { ok: false; reason: string };

export type FinalizeArticle = (input: {
	url: string;
	html: string;
	/** Image bytes that the crawler already fetched inline (SimpleCrawl with
	 * `fetchThumbnail: true`). When present, skip the re-fetch and just upload.
	 * When absent (raw-HTML save, comprehensive crawl), the finalizer fetches
	 * the cascade of og:image / twitter:image / first-<img> candidates itself. */
	preFetchedThumbnail?: ThumbnailImage;
	/** Set by the crawler when the fetched body was itself an image. Routes the
	 * save to image synthesis (host the image, store an `<img>` body, skip
	 * Readability). The browser-extension raw-HTML save leaves this unset; the
	 * finalizer then detects a bare-image capture via `isBareImageCapture`. */
	mediaType?: "image";
}) => Promise<FinalizeArticleResult>;

/**
 * The single source of truth for turning a fetched resource into the canonical
 * `{ html, metadata }` pair that gets persisted as a tier source. Every path
 * that produces an article representation routes through here: SimpleCrawl
 * save / recrawl, ComprehensiveCrawl PDF, stale-check refresh, browser-extension
 * raw-HTML save, dev in-memory wrappers.
 *
 * A resource is one of two shapes:
 *   - An HTML body → parseHtml → downloadMedia → processContent → fetch
 *     og:image (if not pre-fetched) → uploadThumbnail, so metadata.imageUrl
 *     always either points to the Readplace CDN (image fetch succeeded) or
 *     falls back to the raw og:image URL, never silently goes missing.
 *   - An image (the crawler tagged it `mediaType:"image"`, or the captured
 *     body is a bare-image page) → host the image on the CDN and store an
 *     `<img>` body with synthesised metadata. Readability is skipped: it
 *     extracts no text from an image and would persist an empty content body.
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
		const canonicalUrl = resolveCanonicalUrl({ html: input.html, requestedUrl: input.url });

		if (input.mediaType === "image" || isBareImageCapture({ html: input.html, candidates, url: input.url })) {
			const imageResult = await finalizeImageArticle({
				url: input.url,
				candidates,
				preFetchedThumbnail: input.preFetchedThumbnail,
				fetchThumbnailImage,
				putImageObject,
				imagesCdnBaseUrl,
			});
			return { ...imageResult, canonicalUrl };
		}

		const thumbnailUrl = candidates[0] ?? null;

		const parseResult = parseHtml({
			url: input.url,
			html: input.html,
			thumbnailUrl,
		});
		if (!parseResult.ok) return { ok: false, reason: parseResult.reason };

		const { article } = parseResult;
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(input.url);

			/* Drop multi-MB inline base64 images before the body is persisted as the
	 * tier source; downstream finalize handlers re-load the whole source and
	 * OOM on pages that inline tens of MB of images. http(s) <img>
	 * sources are untouched, so they are still mirrored to the CDN. */
		const content = stripOversizedInlineImages(article.content);

		const media = await downloadMedia({
			html: content,
			articleUrl: input.url,
			articleResourceUniqueId,
		});
		const html = await processContent({ html: content, media });

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
			canonicalUrl,
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

/**
 * Build the canonical article for an image resource: host the bytes on the CDN
 * (reusing the pre-fetched bytes when the crawler already has them, else
 * fetching the bare-image candidate) and store an `<img>` body. The title is
 * the image filename; word count is zero, so the summary step skips and the
 * reader renders the image directly. When the image *fetch* fails (the origin
 * blocked the hotlink) the body falls back to the origin URL so the reader
 * still shows something rather than the empty-content dead-end; an upload
 * failure propagates and fails the save.
 */
async function finalizeImageArticle(args: {
	url: string;
	candidates: string[];
	preFetchedThumbnail: ThumbnailImage | undefined;
	fetchThumbnailImage: FetchThumbnailImage;
	putImageObject: PutImageObject;
	imagesCdnBaseUrl: string;
}): Promise<{ ok: true; article: FinalizedArticle }> {
	const { url, candidates, preFetchedThumbnail, fetchThumbnailImage, putImageObject, imagesCdnBaseUrl } = args;
	const { hostname, pathname } = new URL(url);
	const title = imageTitleFromPathname(pathname) || hostname;
	const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);

	const image = preFetchedThumbnail ?? (await fetchThumbnailImage({ candidates, referer: url }));
	const imageUrl = image
		? await uploadThumbnail({ thumbnailImage: image, articleResourceUniqueId, putImageObject, imagesCdnBaseUrl })
		: (candidates[0] ?? url);

	return {
		ok: true,
		article: {
			html: `<figure><img src="${escapeHtmlText(imageUrl)}" alt="${escapeHtmlText(title)}" loading="lazy"></figure>`,
			metadata: {
				title,
				siteName: hostname,
				excerpt: `Image saved from ${hostname}.`,
				wordCount: 0,
				estimatedReadTime: estimatedReadTimeFromWordCount(0),
				imageUrl,
			},
		},
	};
}

/** Filename of the URL's last path segment, extension dropped and separators
 * spaced, as a human-readable image title. Empty when the URL has no usable
 * segment, in which case the caller falls back to the hostname. */
function imageTitleFromPathname(pathname: string): string {
	const lastSegment = pathname.split("/").filter(Boolean).pop() ?? "";
	return lastSegment.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();
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
