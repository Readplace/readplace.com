/**
 * True when one of the page's image candidates resolves to the page URL
 * itself — the shape a browser produces when it renders a bare image URL (the
 * document's only image *is* the page). The browser-extension save path posts
 * that captured HTML with no media-type signal, so the finalizer uses this to
 * route the save to image synthesis instead of Readability, which extracts no
 * text from an image-only document and would otherwise persist an empty body.
 *
 * `candidates` are the absolute image URLs already extracted by
 * `extractThumbnailCandidates`, so each is a valid http(s) URL and `new URL`
 * cannot throw here.
 */
export function isBareImageCapture(params: { candidates: readonly string[]; url: string }): boolean {
	const pageHref = new URL(params.url).href;
	return params.candidates.some((candidate) => new URL(candidate).href === pageHref);
}
