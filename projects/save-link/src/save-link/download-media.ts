import { createHash } from "node:crypto";
import { extensionFromContentType } from "@packages/crawl-article";
import type { HutchLogger } from "@packages/hutch-logger";
import { parseHTML } from "linkedom";
import parseSrcset from "parse-srcset";
import type { CrawlFetch } from "@packages/crawl-article";
import type { ArticleResourceUniqueId } from "./article-resource-unique-id";
import type { PutImageObject } from "./s3-put-image-object";

const MAX_IMAGES = 20;
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

		const imageUrls = extractImageUrls(html);

		const uniqueUrls = [...new Set(imageUrls)].slice(0, MAX_IMAGES);

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

function extractImageUrls(html: string): string[] {
	const { document } = parseHTML(`<div id="root">${html}</div>`);
	const urls: string[] = [];

	for (const img of document.querySelectorAll("img[src]")) {
		const src = img.getAttribute("src");
		if (src && !src.startsWith("data:")) {
			urls.push(src);
		}
	}

	for (const el of document.querySelectorAll("[srcset]")) {
		const srcset = el.getAttribute("srcset");
		if (!srcset) continue;
		/* c8 ignore next 3 -- V8 block coverage phantom: for-of iterator creates zero-count sub-range inside loop body (bcoe/c8#319, v8.dev/blog/javascript-code-coverage) */
		for (const entry of parseSrcset(srcset)) {
			urls.push(entry.url);
		}
	}

	return urls;
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
