import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { buildVerificationEmailHtml } from "./verification-email";

function verifyCtaOf(html: string): URL {
	const cta = [...new JSDOM(html).window.document.querySelectorAll("a[href]")].find(
		(a) => a.textContent?.trim() === "Verify email",
	);
	assert(cta, "the email must render a Verify email link");
	return new URL(cta.getAttribute("href") ?? "");
}

describe("buildVerificationEmailHtml", () => {
	it("links the verify button to the verify URL tagged with the email's own UTM", () => {
		const cta = verifyCtaOf(
			buildVerificationEmailHtml("https://readplace.com/verify?token=abc123"),
		);

		expect(`${cta.origin}${cta.pathname}`).toBe("https://readplace.com/verify");
		expect(cta.searchParams.get("token")).toBe("abc123");
		expect(cta.searchParams.get("utm_source")).toBe("verification-email");
		expect(cta.searchParams.get("utm_medium")).toBe("email");
		expect(cta.searchParams.get("utm_content")).toBe("verify-email");
	});

	it("escapes HTML entities in the URL to prevent injection", () => {
		const cta = verifyCtaOf(
			buildVerificationEmailHtml('https://example.com/verify?a=1&b=2"<>'),
		);

		expect(cta.searchParams.get("a")).toBe("1");
		expect(cta.searchParams.get("b")).toBe('2"<>');
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
