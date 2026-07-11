import { PAYMENT_FAILED_EMAIL_SUBJECT, PaymentFailedEmail } from "./payment-failed-email";

const CTA_URL =
	"https://readplace.com/account?utm_source=payment-failed&utm_medium=email&utm_campaign=dunning";

const baseParams = {
	founderAvatarUrl: "https://readplace.com/fayner-brack.jpg",
	ctaUrl: CTA_URL,
};

describe("PaymentFailedEmail", () => {
	describe("subject", () => {
		it("states the failure plainly and carries no exclamation marks", () => {
			expect(PAYMENT_FAILED_EMAIL_SUBJECT).toBe("your Readplace payment didn't go through");
			expect(PAYMENT_FAILED_EMAIL_SUBJECT).not.toContain("!");
		});
	});

	describe("text/plain body", () => {
		it("contains no exclamation marks and is first-person", () => {
			const text = PaymentFailedEmail(baseParams).to("text/plain");
			expect(text).not.toContain("!");
			expect(text).toMatch(/\bI\b/);
			expect(text).not.toMatch(/\bwe\b/i);
		});

		it("names the price and the WORKING fix — a new card must be made primary, because only the primary card is charged", () => {
			const text = PaymentFailedEmail(baseParams).to("text/plain");
			expect(text).toContain("$49 Readplace payment didn't go through");
			expect(text).toContain("Add a new card on your account page");
			expect(text).toContain("“Make primary”");
			expect(text).toContain("only the primary card is charged");
			expect(text).toContain("If every retry fails, the subscription cancels");
		});

		it("carries no HTML markup — the same paragraphs render into the plain-text body", () => {
			const text = PaymentFailedEmail(baseParams).to("text/plain");
			expect(text).not.toMatch(/<[a-z/]/i);
		});

		it("includes the update-card CTA URL with the utm attribution", () => {
			const text = PaymentFailedEmail(baseParams).to("text/plain");
			expect(text).toContain(`Update your card: ${CTA_URL}`);
			expect(text).toContain("utm_source=payment-failed");
		});

		it("signs off with '— Fayner' and nothing after it", () => {
			const text = PaymentFailedEmail(baseParams).to("text/plain");
			expect(text.trimEnd().endsWith("— Fayner")).toBe(true);
		});
	});

	describe("text/html body", () => {
		it("renders the paragraphs, the founder avatar, and the CTA button", () => {
			const html = PaymentFailedEmail(baseParams).to("text/html");
			expect(html).toContain("Add a new card on your account page");
			expect(html).toContain("fayner-brack.jpg");
			expect(html).toContain("payment-failed");
			expect(html).toContain("Update your card");
			expect(html).toContain("— Fayner");
		});
	});
});
