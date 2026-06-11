/**
 * Inline base64 image payloads (`data:image/…;base64,…`) can dominate an HTML
 * body: one Distill-style research page reached ~40 MB of newline-wrapped
 * base64 across dozens of <img>, while its real article text was a few hundred
 * KB. That body is persisted as the tier source and later re-loaded whole by
 * the select-content / recrawl / refresh handlers, where it OOM'd (#473).
 * Replace every inline base64 image larger than the threshold with a 1×1
 * transparent placeholder so the persisted body stays small and every
 * downstream handler can load it. Payloads at or below the threshold (tiny
 * icons, tracking pixels) are kept verbatim.
 */
export const MAX_INLINE_IMAGE_DATA_URI_BYTES = 2048;

/** 1×1 transparent GIF: keeps the <img> valid without carrying the payload. */
const PLACEHOLDER_DATA_URI =
	"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/* One character class with a single `+` quantifier — a linear scan with no
 * backtracking — so it stays cheap even on a 40 MB body. `\s` absorbs the
 * newline-wrapped base64; the run ends at the closing quote, which is not in
 * the class. */
const INLINE_BASE64_IMAGE = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/g;

export function stripOversizedInlineImages(html: string): string {
	return html.replace(INLINE_BASE64_IMAGE, (match) =>
		match.length > MAX_INLINE_IMAGE_DATA_URI_BYTES ? PLACEHOLDER_DATA_URI : match,
	);
}
