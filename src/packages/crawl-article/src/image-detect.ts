import { MAX_THUMBNAIL_BYTES } from "./extract-thumbnail";

/**
 * The image formats the reader renders through a plain `<img>` — raster formats
 * plus SVG — each paired with the URL path suffixes a direct link to that format
 * uses. The single registry behind both the content-type allowlist (the
 * server-crawl gate, keyed off the HTTP `Content-Type`) and the URL-extension
 * list (the browser-extension path's fast heuristic, keyed off the URL path), so
 * the two cannot name different format sets. `.jpg` and `.jpeg` are both listed because direct
 * `image/jpeg` links use either spelling.
 */
const IMAGE_FORMATS = [
	{ contentType: "image/jpeg", extensions: [".jpg", ".jpeg"] },
	{ contentType: "image/png", extensions: [".png"] },
	{ contentType: "image/gif", extensions: [".gif"] },
	{ contentType: "image/webp", extensions: [".webp"] },
	{ contentType: "image/avif", extensions: [".avif"] },
	{ contentType: "image/svg+xml", extensions: [".svg"] },
] as const;

const SUPPORTED_IMAGE_CONTENT_TYPES: ReadonlySet<string> = new Set(
	IMAGE_FORMATS.map((format) => format.contentType),
);

/**
 * URL path suffixes of a direct image link, derived from {@link IMAGE_FORMATS} so
 * they cannot drift from the content-type allowlist. The browser-extension save
 * path matches these against a captured page's own URL to recognise a bare image.
 */
export const IMAGE_URL_EXTENSIONS: readonly string[] = IMAGE_FORMATS.flatMap(
	(format) => format.extensions,
);

/**
 * Size budget for a single image fetched and hosted on the CDN. Reuses
 * `MAX_THUMBNAIL_BYTES` so every hosted-image path — an image article's primary
 * image, an article thumbnail, and inline body media — shares one cap that
 * cannot drift; `label` is derived from `bytes` so the human-readable form in
 * oversize messages always tracks the cap. Oversize bodies fall back to
 * `unsupported`.
 */
export const MAX_IMAGE_BYTES = {
	bytes: MAX_THUMBNAIL_BYTES,
	label: `${MAX_THUMBNAIL_BYTES / (1024 * 1024)} MB`,
} as const;

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
