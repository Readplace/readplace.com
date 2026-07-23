import { buildInboxEmailIframeSrcdoc } from "./inbox-email-iframe-srcdoc";

const CDN = "https://cdn.test.readplace.com";

describe("buildInboxEmailIframeSrcdoc", () => {
	it("embeds the sanitized body inside a locked-down CSP document pinned to the CDN origin", () => {
		const srcdoc = buildInboxEmailIframeSrcdoc({
			bodyHtml: "<p>Hello CDN</p>",
			imagesCdnBaseUrl: CDN,
		});

		expect(srcdoc).toContain("<p>Hello CDN</p>");
		expect(srcdoc).toContain("default-src 'none'");
		expect(srcdoc).toContain(`img-src data: ${CDN};`);
		// 'self' is dead weight in an opaque-origin sandbox and must not creep back
		// in looking like it permits something.
		expect(srcdoc).not.toContain("'self'");
		expect(srcdoc).toContain("style-src 'unsafe-inline'");
		expect(srcdoc).toContain('<base target="_top">');
	});

	it("injects a base <style> reset so a rehosted wide image cannot overflow the frame", () => {
		const srcdoc = buildInboxEmailIframeSrcdoc({
			bodyHtml: '<img width="600" height="400" alt="hero">',
			imagesCdnBaseUrl: CDN,
		});

		// Caps a surviving `width="600"` attribute at the frame width, keeping the
		// aspect ratio via `height:auto` (the `height` attribute also survives).
		expect(srcdoc).toContain("img{max-width:100%;height:auto}");
		// Deliberate padding over the UA 8px margin; `overflow-wrap:anywhere` breaks
		// long unbroken tracking URLs rendered as bare text; `font-family` lifts
		// near-plaintext forwards out of the iframe UA default (Times).
		expect(srcdoc).toContain(
			"body{margin:0;padding:12px;overflow-wrap:anywhere;font-family:system-ui,-apple-system,sans-serif}",
		);
		// `pre` is the one other allowlisted tag that can force horizontal overflow.
		expect(srcdoc).toContain("pre{white-space:pre-wrap}");
		// The reset must live in the head, never inside the sanitized body.
		expect(srcdoc.indexOf("<style>")).toBeLessThan(srcdoc.indexOf("<body>"));
	});

	it("refuses a CDN base URL that is not a bare https origin", () => {
		// A path, query, or semicolon could smuggle extra CSP source expressions or
		// directives into the policy string.
		expect(() =>
			buildInboxEmailIframeSrcdoc({
				bodyHtml: "<p>x</p>",
				imagesCdnBaseUrl: "https://cdn.test.readplace.com/path",
			}),
		).toThrow(/bare https origin/);
		expect(() =>
			buildInboxEmailIframeSrcdoc({
				bodyHtml: "<p>x</p>",
				imagesCdnBaseUrl: "http://cdn.test.readplace.com",
			}),
		).toThrow(/bare https origin/);
	});
});
