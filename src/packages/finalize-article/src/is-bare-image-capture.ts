import assert from "node:assert";
import { IMAGE_URL_EXTENSIONS } from "@packages/crawl-article";
import { parseHTML } from "linkedom";

/**
 * True when the captured page is a bare image and must be routed to image
 * synthesis instead of Readability (which extracts no text from an image-only
 * document and would persist an empty body). The browser-extension save path
 * posts the captured HTML with no media-type signal, so this is the sole
 * detector on that path.
 *
 * A capture is a bare image when one of its image candidates resolves to the
 * page URL itself — the page *is* one of its own images, the shape a browser
 * produces when it renders a bare image URL — AND either:
 *   - the page URL's path ends in a known image extension, or
 *   - the captured document is structurally a single image with no body text
 *     (`isSingleImageDocument`) — the native image-viewer shape, which detects
 *     extension-less direct images that carry no suffix to match.
 *
 * The self-reference alone is not enough: a real article whose og:image happens
 * to equal its own URL would be misrouted, silently discarding all its text. The
 * extra signal prevents that — an article's URL has no image extension and its
 * document carries body text, so it fails both branches.
 *
 * `candidates` are the absolute image URLs already extracted by
 * `extractThumbnailCandidates`, so each is a valid http(s) URL and `new URL`
 * cannot throw here.
 */
export function isBareImageCapture(params: {
	html: string;
	candidates: readonly string[];
	url: string;
}): boolean {
	const { pathname, href: pageHref } = new URL(params.url);
	const selfReferencing = params.candidates.some((candidate) => new URL(candidate).href === pageHref);
	if (!selfReferencing) return false;
	const pathEndsInImageExtension = IMAGE_URL_EXTENSIONS.some((extension) =>
		pathname.toLowerCase().endsWith(extension),
	);
	return pathEndsInImageExtension || isSingleImageDocument(params.html);
}

/**
 * Whether the document's only content is a single image: exactly one `<img>` and
 * no body text. This is the shape a browser renders for a direct image URL — the
 * dimensions shown in the tab title live in `<head>`, not the body. A real
 * article fails it (it carries body text, and usually more than one image), so
 * using it as a positive signal cannot strip the text from an article.
 */
function isSingleImageDocument(html: string): boolean {
	const { document } = parseHTML(html);
	if (document.querySelectorAll("img").length !== 1) return false;
	const bodyText = document.body.textContent;
	assert(bodyText !== null, "linkedom's <body> always exposes textContent");
	return bodyText.trim() === "";
}
