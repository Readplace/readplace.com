import { createHash } from "node:crypto";
import { extensionFromContentType } from "@packages/crawl-article";
import type { HutchLogger } from "@packages/hutch-logger";
import { parseHTML } from "linkedom";
import parseSrcset from "parse-srcset";
import type { CrawlFetch } from "@packages/crawl-article";
import type { ArticleResourceUniqueId } from "./article-resource-unique-id";
import type { PutImageObject } from "../../providers/article-store/s3-put-image-object";

const MAX_IMAGES = 20;
const MAX_RENDITIONS_PER_IMAGE = 24;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 5_000;
const CONCURRENCY = 5;

export type DownloadedMedia = { originalUrl: string; cdnUrl: string };

export type DownloadMedia = (params: {
	html: string;
	articleUrl: string;
	articleResourceUniqueId: ArticleResourceUniqueId;
}) => Promise<DownloadedMedia[]>;

export function initDownloadMedia(deps: {
	putImageObject: PutImageObject;
	logger: HutchLogger;
	crawlFetch: CrawlFetch;
	imagesCdnBaseUrl: string;
}): DownloadMedia {
	const { putImageObject, logger, crawlFetch, imagesCdnBaseUrl } = deps;

	return async ({ html, articleUrl, articleResourceUniqueId }) => {
		const results: DownloadedMedia[] = [];

		const uniqueUrls = selectImageUrls(html);

		for (let i = 0; i < uniqueUrls.length; i += CONCURRENCY) {
			const batch = uniqueUrls.slice(i, i + CONCURRENCY);
			await Promise.all(batch.map(async (originalUrl) => {
				try {
					const downloaded = await downloadImage({ crawlFetch, url: originalUrl, referer: articleUrl });
					if (!downloaded) return;

					const hash = createHash("sha256").update(originalUrl).digest("hex").slice(0, 16);
					const ext = extensionFromContentType({ contentType: downloaded.contentType, url: originalUrl });
					const filename = `${hash}${ext}`;
					const key = articleResourceUniqueId.toS3ImageKey(filename);
					const cdnUrl = articleResourceUniqueId.toImageCdnUrl({ baseUrl: imagesCdnBaseUrl, filename });

					await putImageObject({ key, body: downloaded.body, contentType: downloaded.contentType });
					results.push({ originalUrl, cdnUrl });
				} catch (error) {
					logger.error("[DownloadMedia] failed to process image", { url: originalUrl, error });
				}
			}));
		}

		return results;
	};
}

type DomDocument = ReturnType<typeof parseHTML>["document"];
type DomElement = NonNullable<ReturnType<DomDocument["querySelector"]>>;

function selectImageUrls(html: string): string[] {
	const seen = new Set<string>();
	const urls: string[] = [];
	for (const group of extractImageGroups(html).slice(0, MAX_IMAGES)) {
		for (const url of group.slice(0, MAX_RENDITIONS_PER_IMAGE)) {
			if (seen.has(url)) continue;
			seen.add(url);
			urls.push(url);
		}
	}
	return urls;
}

/* Group rendition URLs by their owning image — every <source srcset> entry and
 * <img> inside a <picture> is one image; a standalone <img> is another. Capping
 * by group rather than by URL keeps a figure's renditions together, so an
 * in-budget figure is mirrored in full and no srcset slot has to fall back to a
 * neighbour's image or hot-link the origin. */
function extractImageGroups(html: string): string[][] {
	const { document } = parseHTML(`<div id="root">${html}</div>`);
	const groups: string[][] = [];

	for (const el of document.querySelectorAll("picture, img")) {
		if (el.localName === "picture") {
			groups.push(collectPictureRenditions(el));
		} else if (!el.closest("picture")) {
			groups.push(collectImageRenditions(el));
		}
	}

	return groups;
}

function collectPictureRenditions(picture: DomElement): string[] {
	const urls: string[] = [];
	for (const source of picture.querySelectorAll("source[srcset]")) {
		pushSrcsetUrls(urls, source.getAttribute("srcset"));
	}
	for (const img of picture.querySelectorAll("img")) {
		pushImageUrls(urls, img);
	}
	return urls;
}

function collectImageRenditions(img: DomElement): string[] {
	const urls: string[] = [];
	pushImageUrls(urls, img);
	return urls;
}

function pushImageUrls(urls: string[], img: DomElement): void {
	const src = img.getAttribute("src");
	if (src && !src.startsWith("data:")) urls.push(src);
	pushSrcsetUrls(urls, img.getAttribute("srcset"));
}

function pushSrcsetUrls(urls: string[], srcset: string | null): void {
	if (!srcset) return;
	/* c8 ignore next 3 -- V8 block coverage phantom: for-of iterator creates zero-count sub-range inside loop body (bcoe/c8#319, v8.dev/blog/javascript-code-coverage) */
	for (const entry of parseSrcset(srcset)) {
		urls.push(entry.url);
	}
}

async function downloadImage(args: {
	crawlFetch: CrawlFetch;
	url: string;
	referer: string;
}): Promise<{ body: Buffer; contentType: string } | undefined> {
	const { crawlFetch, url, referer } = args;
	const response = await crawlFetch(url, {
		signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
		headers: { accept: "image/*,*/*;q=0.8" },
		referer,
	});

	if (!response.ok) return undefined;

	const contentType = response.headers.get("content-type") ?? "application/octet-stream";
	if (!contentType.startsWith("image/") && contentType !== "application/octet-stream") {
		return undefined;
	}

	const contentLength = response.headers.get("content-length");
	if (contentLength && Number.parseInt(contentLength, 10) > MAX_IMAGE_BYTES) {
		return undefined;
	}
	const arrayBuffer = await response.arrayBuffer();
	const body = Buffer.from(arrayBuffer);

	if (body.length > MAX_IMAGE_BYTES) return undefined;

	return { body, contentType };
}
