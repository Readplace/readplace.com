/**
 * Escape text for safe interpolation into both element bodies and double-quoted
 * attribute values. Over-escaping `"`/`'` inside element text is harmless, so a
 * single function covers both positions.
 */
export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/** Hostname for display, falling back to the raw string for non-URL input. */
export function hostnameOf(url: string): string {
	try {
		return new URL(url).hostname;
	} catch {
		return url;
	}
}
