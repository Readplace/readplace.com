import { buildInboxEmailIframeSrcdoc } from "./inbox-email-iframe-srcdoc";

describe("buildInboxEmailIframeSrcdoc", () => {
	it("embeds the sanitized body inside a locked-down CSP document", () => {
		const srcdoc = buildInboxEmailIframeSrcdoc({ bodyHtml: "<p>Hello CDN</p>" });

		expect(srcdoc).toContain("<p>Hello CDN</p>");
		expect(srcdoc).toContain("default-src 'none'");
		expect(srcdoc).toContain("img-src 'self' data:");
		expect(srcdoc).toContain("style-src 'unsafe-inline'");
		expect(srcdoc).toContain('<base target="_top">');
	});
});
