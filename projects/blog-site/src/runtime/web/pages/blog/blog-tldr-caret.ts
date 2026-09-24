import { iconSvg } from "@packages/ui-icons";

const TLDR_SUMMARY = /(<summary class="blog-tldr__toggle">[^<]*)<\/summary>/g;

/** Draws the TL;DR disclosure's caret into every post at render time.
 *
 * The `<summary>` is hand-written HTML inside each post's markdown, so authoring
 * the caret beside it would paste the same icon geometry into 58 content files
 * and put a drawing where prose belongs. Injecting it once here keeps the icon
 * in the shared set and leaves the posts as text; the markdown representation is
 * the untouched source, which never carried the caret either. */
export function withTldrCaret(html: string): string {
	return html.replace(
		TLDR_SUMMARY,
		`$1<span class="blog-tldr__caret">${iconSvg("chevron-down")}</span></summary>`,
	);
}
