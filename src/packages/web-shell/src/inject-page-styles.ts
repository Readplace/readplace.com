import assert from "node:assert";
import type { CspNonce } from "./csp-nonce.middleware";

/**
 * Inject page-specific CSS as a <style> element inside <main>, so that htmx
 * navigation (hx-target="main" hx-select="main" hx-swap="outerHTML") swaps the
 * page's CSS atomically with its content. Without this, htmx leaves the
 * previous page's <style> stranded in <head>, defacing the new page's layout.
 *
 * String insert, NOT linkedom's parseHTML. A DOM parse-then-serialize round-trip
 * decodes one level of HTML escaping, and the reader iframe's `srcdoc` is
 * intentionally double-escaped, so a code sample like `&amp;lt;input&amp;gt;`
 * would collapse into a live `<input>` inside the frame. A parser is the right
 * tool only for untrusted markup crossing a network boundary; this is trusted
 * server markup whose escaping must survive byte-for-byte. Do not restore parseHTML.
 */
export function injectPageStylesIntoMain(input: {
	content: string;
	styles: string;
	cspNonce: CspNonce;
}): string {
	const { content, styles } = input;
	if (!styles) return content;
	const styleTag = `<style nonce="${input.cspNonce}">${styles}</style>`;
	const updated = content.replace(/<main(?=[\s/>])[^>]*>/i, (mainTag) => mainTag + styleTag);
	assert(updated !== content, "PageBody.content must contain a <main> element when styles are provided");
	return updated;
}
