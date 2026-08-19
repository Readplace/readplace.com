import type { CrawlArticleResult } from "./crawl-article.types";
import { extensionFromContentType } from "./extension-from-content-type";
import { headerOrUndefined } from "./header-utils";
import { MAX_IMAGE_BYTES } from "./image-detect";
import { escapeHtmlText } from "./pdf-html-helpers";

/**
 * Image body → article result. The crawler already holds the decoded bytes, so
 * it carries them on `thumbnail.image` for the finalizer to upload to the CDN
 * (no second fetch) and tags the result `mediaType:"image"` so the finalizer
 * synthesises an `<img>` body rather than running Readability — which returns
 * null for a text-free document and would otherwise persist empty content. The
 * inline `html` is a self-contained fallback for callers that bypass the
 * finalizer; it points at the origin URL because the CDN copy does not exist
 * yet. Oversize bodies surface as `unsupported`, mirroring `parsePdfFromBuffer`.
 */
export function parseImageFromBuffer(input: {
	buffer: Buffer;
	bodyHash: string;
	response: Response;
	url: string;
	contentType: string;
	logError: (message: string, error?: Error) => void;
}): CrawlArticleResult {
	if (input.buffer.length > MAX_IMAGE_BYTES.bytes) {
		input.logError(
			`[CrawlArticle] Image body too large (${input.buffer.length} bytes, cap ${MAX_IMAGE_BYTES.label}) for ${input.url}`,
		);
		return {
			status: "unsupported",
			reason: `image body too large: ${input.buffer.length} bytes (cap ${MAX_IMAGE_BYTES.label})`,
		};
	}
	return {
		status: "fetched",
		mediaType: "image",
		html: `<figure><img src="${escapeHtmlText(input.url)}" alt=""></figure>`,
		thumbnail: {
			image: {
				body: input.buffer,
				contentType: input.contentType,
				url: input.url,
				extension: extensionFromContentType({ contentType: input.contentType, url: input.url }),
			},
			provenUnusable: [],
		},
		etag: headerOrUndefined(input.response.headers, "etag"),
		lastModified: headerOrUndefined(input.response.headers, "last-modified"),
		bodyHash: input.bodyHash,
	};
}
