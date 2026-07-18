import { createHash } from "node:crypto";
import {
	BodyTooLargeError,
	extensionFromContentType,
	MAX_IMAGE_BYTES,
	readBodyWithCap,
} from "@packages/crawl-article";
import type { CrawlFetch } from "@packages/crawl-article";
import type { HutchLogger } from "@packages/hutch-logger";
import { parseHTML } from "linkedom";

const MAX_IMAGES = 20;
const DOWNLOAD_TIMEOUT_MS = 5_000;
const CONCURRENCY = 5;
/** An `<img>` declaring itself at most this many pixels wide AND tall is a
 * tracking pixel, not content — it is never fetched, so not even the single
 * ingest-time request reaches the sender for it. */
const TRACKING_PIXEL_MAX_DIMENSION = 3;

/** One remote newsletter image, downloaded once per message. `filename` is
 * derived from the original URL (hash + extension), so every recipient's copy
 * shares it and a redelivered message overwrites the same keys. */
export interface DownloadedEmailImage {
	originalUrl: string;
	body: Buffer;
	contentType: string;
	filename: string;
}

/**
 * A URL that fails (unreachable, non-image, oversize) is absent from the
 * result, so the sanitizer strips its src — the pre-rehost behaviour — and the
 * email body still stores.
 */
export type DownloadEmailImages = (input: { html: string }) => Promise<DownloadedEmailImage[]>;

/**
 * Download each remote newsletter image exactly once per message, before the
 * per-recipient fan-out, so the sender's server sees a single AWS-origin fetch
 * and the reader's IP and read-time never leak. The per-recipient S3 uploads
 * (and the opaque keys they land under) are the body-store step's concern —
 * this stage is network-only.
 */
export function initDownloadEmailImages(deps: {
	crawlFetch: CrawlFetch;
	logger: HutchLogger;
}): DownloadEmailImages {
	const { crawlFetch, logger } = deps;

	return async ({ html }) => {
		const downloaded: DownloadedEmailImage[] = [];
		const urls = selectRemoteImageUrls(html);
		for (let i = 0; i < urls.length; i += CONCURRENCY) {
			await Promise.all(
				urls.slice(i, i + CONCURRENCY).map(async (originalUrl) => {
					try {
						const image = await downloadImage({ crawlFetch, url: originalUrl });
						if (!image) return;
						const hash = createHash("sha256").update(originalUrl).digest("hex").slice(0, 16);
						downloaded.push({
							originalUrl,
							body: image.body,
							contentType: image.contentType,
							filename: `${hash}${extensionFromContentType({
								contentType: image.contentType,
								url: originalUrl,
							})}`,
						});
					} catch (error) {
						logger.error("[download-email-images] failed to download image", {
							url: originalUrl,
							error,
						});
					}
				}),
			);
		}
		return downloaded;
	};
}

type DomDocument = ReturnType<typeof parseHTML>["document"];
type DomElement = NonNullable<ReturnType<DomDocument["querySelector"]>>;

function selectRemoteImageUrls(html: string): string[] {
	const { document } = parseHTML(`<div id="root">${html}</div>`);
	const seen = new Set<string>();
	for (const img of document.querySelectorAll("img")) {
		const src = img.getAttribute("src");
		// Skips data:, cid:, email://cid/, relative, and protocol-relative srcs —
		// everything the sanitizer will strip or has already rehosted.
		if (!src || !/^https?:\/\//i.test(src)) continue;
		if (isDeclaredTrackingPixel(img)) continue;
		if (seen.size >= MAX_IMAGES) break;
		seen.add(src);
	}
	return [...seen];
}

function isDeclaredTrackingPixel(img: DomElement): boolean {
	const width = Number.parseInt(img.getAttribute("width") ?? "", 10);
	const height = Number.parseInt(img.getAttribute("height") ?? "", 10);
	return (
		width <= TRACKING_PIXEL_MAX_DIMENSION &&
		height <= TRACKING_PIXEL_MAX_DIMENSION
	);
}

async function downloadImage(args: {
	crawlFetch: CrawlFetch;
	url: string;
}): Promise<{ body: Buffer; contentType: string } | undefined> {
	const { crawlFetch, url } = args;
	const response = await crawlFetch(url, {
		signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
		headers: { accept: "image/*,*/*;q=0.8" },
	});

	if (!response.ok) return undefined;

	const contentType = response.headers.get("content-type") ?? "application/octet-stream";
	if (!contentType.startsWith("image/") && contentType !== "application/octet-stream") {
		return undefined;
	}

	const contentLength = response.headers.get("content-length");
	if (contentLength && Number.parseInt(contentLength, 10) > MAX_IMAGE_BYTES.bytes) {
		return undefined;
	}
	try {
		// Incremental cap: arrayBuffer() would buffer a chunked / Content-Length-less
		// (or gzip-inflating) body in full before its size could be checked.
		const body = await readBodyWithCap(response, MAX_IMAGE_BYTES.bytes);
		return { body, contentType };
	} catch (error) {
		if (error instanceof BodyTooLargeError) return undefined;
		throw error;
	}
}
