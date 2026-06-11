/**
 * Image file extensions a browser renders as a bare image at its own URL. The
 * page URL's path must end in one before a self-referencing candidate counts as
 * a bare-image capture: a real article URL ends in a slug, an id, `.html`, or
 * nothing — never an image extension — so this guard stops an article whose
 * og:image / first `<img>` happens to resolve to its own URL from being
 * misrouted to image synthesis, which skips Readability and would silently
 * discard all the article's text. `.jpg` and `.jpeg` are both listed because
 * direct image links use either spelling.
 */
const IMAGE_URL_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".svg"];

/**
 * True when the page is a bare image: its URL path ends in an image extension
 * *and* one of its image candidates resolves to the page URL itself — the shape
 * a browser produces when it renders a bare image URL (the document's only
 * image *is* the page). The browser-extension save path posts that captured
 * HTML with no media-type signal, so the finalizer uses this to route the save
 * to image synthesis instead of Readability, which extracts no text from an
 * image-only document and would otherwise persist an empty body.
 *
 * `candidates` are the absolute image URLs already extracted by
 * `extractThumbnailCandidates`, so each is a valid http(s) URL and `new URL`
 * cannot throw here.
 */
export function isBareImageCapture(params: { candidates: readonly string[]; url: string }): boolean {
	const { pathname, href: pageHref } = new URL(params.url);
	const path = pathname.toLowerCase();
	if (!IMAGE_URL_EXTENSIONS.some((extension) => path.endsWith(extension))) return false;
	return params.candidates.some((candidate) => new URL(candidate).href === pageHref);
}
