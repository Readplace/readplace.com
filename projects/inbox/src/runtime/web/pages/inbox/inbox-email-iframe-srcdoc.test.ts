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
