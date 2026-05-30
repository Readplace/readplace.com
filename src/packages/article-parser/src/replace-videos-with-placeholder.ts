import assert from "node:assert";

/* Native <video> elements never play in the reader: the body is rendered
 * inside a sandboxed iframe with no allow-scripts, and many publishers
 * lazy-load videos via JS (data-src/data-poster) so the stored
 * pre-hydration HTML has no playable src either way. Substitute each
 * <video> with a small text callout that links back to the original
 * article. The placeholder element is built by an injected
 * `renderPlaceholder` so the user-facing copy stays in a single pure
 * function next to the rest of the reader-parser copy. */
export function replaceVideosWithPlaceholder(params: {
	document: Document;
	originalUrl: string;
	renderPlaceholder: (ctx: {
		document: Document;
		originalUrl: string;
		hostname: string;
	}) => Element;
}): void {
	const hostname = new URL(params.originalUrl).hostname;
	const videos = Array.from(params.document.querySelectorAll("video"));
	for (const video of videos) {
		const placeholder = params.renderPlaceholder({
			document: params.document,
			originalUrl: params.originalUrl,
			hostname,
		});
		const parent = video.parentNode;
		assert(parent, "Video element selected from the document must have a parent node");
		parent.insertBefore(placeholder, video);
		video.remove();
	}
}
