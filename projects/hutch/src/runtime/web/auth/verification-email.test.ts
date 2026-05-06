import { buildVerificationEmailHtml } from "./verification-email";

describe("buildVerificationEmailHtml", () => {
	it("includes the verify URL in the email link", () => {
		const html = buildVerificationEmailHtml("https://readplace.com/verify?token=abc123");

		expect(html).toContain('href="https://readplace.com/verify?token&#x3D;abc123"');
	});

	it("escapes HTML entities in the URL to prevent injection", () => {
		const html = buildVerificationEmailHtml('https://example.com/verify?a=1&b=2"<>');

		expect(html).toContain('href="https://example.com/verify?a&#x3D;1&amp;b&#x3D;2&quot;&lt;&gt;"');
	});

	it("renders the email subject heading", () => {
		const html = buildVerificationEmailHtml("https://readplace.com/verify");

		expect(html).toContain("Verify your email");
	});

	it("produces a complete HTML document", () => {
		const html = buildVerificationEmailHtml("https://readplace.com/verify");

		expect(html).toContain("<!DOCTYPE html>");
		expect(html).toContain("</html>");
	});
});
