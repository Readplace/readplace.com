import { CheckoutRecoveryEmail } from "./checkout-recovery-email";

describe("CheckoutRecoveryEmail", () => {
	const baseParams = {
		founderAvatarUrl: "https://readplace.com/fayner-brack.jpg",
		resumeUrl: "https://readplace.com/signup?email=jane%40example.com&utm_source=recovery",
		monthlyPrice: "$3.99",
		yearlyDiscount: "20%",
	};

	it("includes the resume URL on the CTA anchor", () => {
		const html = CheckoutRecoveryEmail(baseParams).to("text/html");

		expect(html).toContain(
			'href="https://readplace.com/signup?email&#x3D;jane%40example.com&amp;utm_source&#x3D;recovery"',
		);
		expect(html).toContain(">Resume your trial</a>");
	});

	it("renders the founder avatar with the absolute URL", () => {
		const html = CheckoutRecoveryEmail(baseParams).to("text/html");

		expect(html).toContain('src="https://readplace.com/fayner-brack.jpg"');
		expect(html).toContain('alt="Fayner Brack"');
		expect(html).toContain("border-radius:50%");
	});

	it("escapes HTML entities in the avatar and resume URLs", () => {
		const html = CheckoutRecoveryEmail({
			...baseParams,
			founderAvatarUrl: "https://readplace.com/avatar.jpg?\"'<>&",
			resumeUrl: "https://readplace.com/signup?email=a&b=\"'<>",
		}).to("text/html");

		expect(html).toContain("src=\"https://readplace.com/avatar.jpg?&quot;&#x27;&lt;&gt;&amp;\"");
		expect(html).toContain(
			"href=\"https://readplace.com/signup?email&#x3D;a&amp;b&#x3D;&quot;&#x27;&lt;&gt;\"",
		);
	});

	it("produces a complete HTML document with the subject heading content", () => {
		const html = CheckoutRecoveryEmail(baseParams).to("text/html");

		expect(html).toContain("<!DOCTYPE html>");
		expect(html).toContain("</html>");
		expect(html).toContain("Did something stop you?");
	});

	it("renders pricing from params in both HTML and text", () => {
		const email = CheckoutRecoveryEmail(baseParams);
		const html = email.to("text/html");
		const text = email.to("text/plain");

		expect(html).toContain("$3.99 a month");
		expect(html).toContain("20% off");
		expect(text).toContain("$3.99 a month");
		expect(text).toContain("20% off");
	});

	it("returns a plain-text body containing the resume URL on its own line", () => {
		const text = CheckoutRecoveryEmail(baseParams).to("text/plain");

		const lines = text.split("\n");
		expect(lines).toContain(
			"https://readplace.com/signup?email=jane%40example.com&utm_source=recovery",
		);
		expect(text).toContain("Hi there,");
		expect(text).toContain("\u2014 Fayner");
		expect(text).toContain("readplace.com");
		expect(text).toContain("If you'd rather not hear from me, just reply STOP.");
	});
});
