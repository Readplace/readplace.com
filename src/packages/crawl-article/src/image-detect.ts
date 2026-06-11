import { MAX_THUMBNAIL_BYTES } from "./extract-thumbnail";

/**
 * The image content-types the crawler turns into an `<img>` article. Raster
 * formats plus SVG — all of which a browser renders through a plain `<img>`.
 */
const SUPPORTED_IMAGE_CONTENT_TYPES = new Set([
	"image/jpeg",
	"image/png",
	"image/gif",
	"image/webp",
	"image/avif",
	"image/svg+xml",
]);

/**
 * Size budget for a single image fetched and hosted on the CDN. Reuses
 * `MAX_THUMBNAIL_BYTES` so every hosted-image path — an image article's primary
 * image, an article thumbnail, and inline body media — shares one cap that
 * cannot drift; `.label` is the human-readable form for oversize messages.
 * Oversize bodies fall back to `unsupported`.
 */
export const MAX_IMAGE_BYTES = { bytes: MAX_THUMBNAIL_BYTES, label: "5 MB" } as const;

/**
 * Whether the `Content-Type` names an image the reader can display. Classified
 * by header alone — no magic-byte sniff: origins and asset CDNs label images
 * reliably (unlike PDFs, which are often `application/octet-stream`), and a
 * mislabelled body only yields a broken `<img>`, never script execution (the
 * reader iframe runs with no `allow-scripts`).
 */
export function isSupportedImageContentType(contentType: string): boolean {
	const mimeBase = contentType.split(";")[0].trim().toLowerCase();
	return SUPPORTED_IMAGE_CONTENT_TYPES.has(mimeBase);
}
