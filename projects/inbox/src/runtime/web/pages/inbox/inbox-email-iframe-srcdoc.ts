/**
 * Build the HTML document embedded in the View-tab iframe's `srcdoc`. This is
 * Layer 2 of the email sanitization defence (Layer 1 is the server-side
 * `sanitize-html` allowlist that produced `bodyHtml`).
 *
 * The iframe element itself carries `sandbox="allow-popups
 * allow-popups-to-escape-sandbox"` — deliberately WITHOUT `allow-scripts` or
 * `allow-same-origin`, so no script runs and the document cannot read
 * `document.cookie`/storage. This document adds a restrictive per-iframe CSP:
 * `default-src 'none'` blocks every fetch/script/frame; `img-src 'self' data:`
 * permits only the inline `cid:` images the sanitizer rewrote to `data:` URIs
 * (belt-and-suspenders with Layer 1's remote-image stripping); `style-src
 * 'unsafe-inline'` keeps the email's own
 * inline styling. `<base target="_top">` makes any surviving link open the top
 * tab. `bodyHtml` is already allowlist-sanitized.
 */
export function buildInboxEmailIframeSrcdoc(input: { bodyHtml: string }): string {
	return [
		"<!doctype html><html><head>",
		'<meta charset="utf-8">',
		'<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src \'self\' data:; style-src \'unsafe-inline\';">',
		'<base target="_top">',
		"</head><body>",
		input.bodyHtml,
		"</body></html>",
	].join("");
}
