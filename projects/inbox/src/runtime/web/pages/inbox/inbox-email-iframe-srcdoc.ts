import assert from "node:assert";

/**
 * Build the HTML document embedded in the View-tab iframe's `srcdoc`. This is
 * Layer 2 of the email sanitization defence (Layer 1 is the server-side
 * `sanitize-html` allowlist that produced `bodyHtml`).
 *
 * The iframe element itself carries `sandbox="allow-popups
 * allow-popups-to-escape-sandbox"` — deliberately WITHOUT `allow-scripts` or
 * `allow-same-origin`, so no script runs and the document cannot read
 * `document.cookie`/storage. This document adds a restrictive per-iframe CSP:
 * `default-src 'none'` blocks every fetch/script/frame; `img-src data:
 * <imagesCdnBaseUrl>` permits only the inline `cid:` images the sanitizer
 * rewrote to `data:` URIs and the remote images the receive path rehosted to
 * our CDN — the host pin is what keeps "no tracking beacon can fire" true even
 * against a future sanitizer regression; `style-src 'unsafe-inline'` keeps the
 * email's own inline styling AND legitimizes the base `<style>` reset below, so
 * do not tighten it to nonce-only — that reset is the only thing that caps a
 * rehosted `width="600"` hero image to the frame width (the sanitizer's `style=`
 * allowlist has no `width`/`max-width`, so a surviving `width` attribute would
 * otherwise force a horizontal scrollbar inside the ~350px frame on a phone).
 * `<base target="_top">` makes any surviving link open the top tab. `bodyHtml`
 * is already allowlist-sanitized.
 */
export function buildInboxEmailIframeSrcdoc(input: {
	bodyHtml: string;
	imagesCdnBaseUrl: string;
}): string {
	// A bare https origin is the only shape that is both a valid CSP source
	// expression and incapable of smuggling extra directives into the policy.
	assert(
		/^https:\/\/[a-z0-9.-]+$/i.test(input.imagesCdnBaseUrl),
		"imagesCdnBaseUrl must be a bare https origin (no path, no trailing slash)",
	);
	return [
		"<!doctype html><html><head>",
		'<meta charset="utf-8">',
		`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: ${input.imagesCdnBaseUrl}; style-src 'unsafe-inline';">`,
		"<style>img{max-width:100%;height:auto}table{max-width:100%}body{margin:0;padding:12px;overflow-wrap:anywhere;font-family:system-ui,-apple-system,sans-serif}pre{white-space:pre-wrap}</style>",
		'<base target="_top">',
		"</head><body>",
		input.bodyHtml,
		"</body></html>",
	].join("");
}
