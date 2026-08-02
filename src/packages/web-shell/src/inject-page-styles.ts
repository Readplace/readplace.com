import assert from "node:assert";

/**
 * String insert, NOT linkedom's parseHTML. A DOM parse-then-serialize round-trip
 * decodes one level of HTML escaping, and the reader iframe's `srcdoc` is
 * intentionally double-escaped, so a code sample like `&amp;lt;input&amp;gt;`
 * would collapse into a live `<input>` inside the frame. A parser is the right
 * tool only for untrusted markup crossing a network boundary; this is trusted
 * server markup whose escaping must survive byte-for-byte. Do not restore parseHTML.
 */
export function injectPageStylesIntoMain(content: string, styles: string | { href: string }): string {
	if (typeof styles === "string" && !styles) return content;
	const styleTag =
		typeof styles === "string"
			? `<style>${styles}</style>`
			: `<link rel="stylesheet" href="${styles.href}">`;
	const updated = content.replace(/<main(?=[\s/>])[^>]*>/i, (mainTag) => mainTag + styleTag);
	assert(updated !== content, "PageBody.content must contain a <main> element when styles are provided");
	return updated;
}

export function pageStylesheetPreload(styles: string | { href: string }): string {
	if (typeof styles === "string") return "";
	return `<link rel="preload" as="style" href="${styles.href}">`;
}
