import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { buildPasswordResetEmailHtml } from "./password-reset-email";

function resetCtaOf(html: string): URL {
	const cta = [...new JSDOM(html).window.document.querySelectorAll("a[href]")].find(
		(a) => a.textContent?.trim() === "Reset password",
	);
	assert(cta, "the email must render a Reset password link");
	return new URL(cta.getAttribute("href") ?? "");
}

describe("buildPasswordResetEmailHtml", () => {
	it("links the reset button to the reset URL tagged with the email's own UTM", () => {
		const cta = resetCtaOf(
			buildPasswordResetEmailHtml("https://readplace.com/reset-password?token=abc"),
		);

		expect(`${cta.origin}${cta.pathname}`).toBe("https://readplace.com/reset-password");
		expect(cta.searchParams.get("token")).toBe("abc");
		expect(cta.searchParams.get("utm_source")).toBe("password-reset-email");
		expect(cta.searchParams.get("utm_medium")).toBe("email");
		expect(cta.searchParams.get("utm_content")).toBe("reset-password");
	});
});
