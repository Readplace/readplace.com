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
 * Cap on the image body the crawler will store as an article. Mirrors the
 * thumbnail cap in `extract-thumbnail.ts` so a primary image and an article
 * thumbnail share one size budget; oversize bodies fall back to `unsupported`.
 */
export const MAX_IMAGE_BYTES = { bytes: 5 * 1024 * 1024, label: "5 MB" } as const;

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
