/** Reverses the entity encoding a serialized-HTML source leaves in text and
 * URLs (an href survives regex extraction as `?a=1&amp;b=2`). `&amp;` is
 * decoded last so a double-encoded sequence like `&amp;lt;` decodes exactly
 * one level. */
export function decodeHtmlEntities(value: string): string {
	return value
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&");
}
