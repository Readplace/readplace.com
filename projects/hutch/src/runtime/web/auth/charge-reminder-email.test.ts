import { ChargeReminderEmail } from "./charge-reminder-email";

const CTA_URL =
	"https://readplace.com/account?utm_source=charge-reminder&utm_medium=email&utm_campaign=trial-precharge";

const baseParams = {
	founderAvatarUrl: "https://readplace.com/fayner-brack.jpg",
	chargeAt: "2026-07-24T00:00:00.000Z",
	ctaUrl: CTA_URL,
};

describe("ChargeReminderEmail", () => {
	describe("subject", () => {
		it("names the charge date and carries no exclamation marks", () => {
			const email = ChargeReminderEmail(baseParams);
			expect(email.subject).toBe("your Readplace membership starts on Jul 24, 2026");
			expect(email.subject).not.toContain("!");
		});
	});

	describe("text/plain body", () => {
		it("contains no exclamation marks and is first-person", () => {
			const text = ChargeReminderEmail(baseParams).to("text/plain");
			expect(text).not.toContain("!");
			expect(text).toMatch(/\bI\b/);
			expect(text).not.toMatch(/\bwe\b/i);
		});

		it("states the charge the chosen plan actually makes, the charge date, and how often it repeats", () => {
			const text = ChargeReminderEmail({ ...baseParams, plan: "yearly" }).to("text/plain");
			expect(text).toContain("$60 charged to the card on file on Jul 24, 2026");
			expect(text).toContain("Your free trial ends on Jul 24, 2026. You added a card when you upgraded, so");
			expect(text).toContain("once a year after that");
		});

		it("quotes each plan its own charge and cadence", () => {
			const monthly = ChargeReminderEmail({ ...baseParams, plan: "monthly" }).to("text/plain");
			expect(monthly).toContain("$10 charged to the card on file");
			expect(monthly).toContain("once a month after that");

			const triennial = ChargeReminderEmail({ ...baseParams, plan: "triennial" }).to(
				"text/plain",
			);
			expect(triennial).toContain("$108 charged to the card on file");
			expect(triennial).toContain("once every 3 years after that");
		});

		it("states the amount Stripe will charge when a once-only coupon discounts the first charge, then the list price it renews at", () => {
			const text = ChargeReminderEmail({
				...baseParams,
				plan: "yearly",
				charge: { amountMinor: 4900, currency: "usd", at: baseParams.chargeAt },
			}).to("text/plain");
			expect(text).toContain(
				"— $49.00 charged to the card on file on Jul 24, 2026, then $60 once a year after that.",
			);
		});

		it("names each plan's own list price for the renewal after a discounted first charge", () => {
			const monthly = ChargeReminderEmail({
				...baseParams,
				plan: "monthly",
				charge: { amountMinor: 500, currency: "usd", at: baseParams.chargeAt },
			}).to("text/plain");
			expect(monthly).toContain("— $5.00 charged to the card on file on Jul 24, 2026, then $10 once a month after that.");

			const triennial = ChargeReminderEmail({
				...baseParams,
				plan: "triennial",
				charge: { amountMinor: 9700, currency: "usd", at: baseParams.chargeAt },
			}).to("text/plain");
			expect(triennial).toContain(
				"— $97.00 charged to the card on file on Jul 24, 2026, then $108 once every 3 years after that.",
			);
		});

		it("words a list-price charge from Stripe exactly as the list-price fallback does, so the email reads the same whether or not Stripe answered", () => {
			const fromStripe = ChargeReminderEmail({
				...baseParams,
				plan: "yearly",
				charge: { amountMinor: 6000, currency: "usd", at: baseParams.chargeAt },
			}).to("text/plain");
			const fallback = ChargeReminderEmail({ ...baseParams, plan: "yearly" }).to("text/plain");
			expect(fromStripe).toContain("— $60 charged to the card on file on Jul 24, 2026, then once a year after that.");
			expect(fromStripe).toBe(fallback);
		});

		it("dates the charge from Stripe's charge, so the amount and the date always describe the same charge", () => {
			const email = ChargeReminderEmail({
				...baseParams,
				plan: "yearly",
				charge: { amountMinor: 4900, currency: "usd", at: "2026-08-07T00:00:00.000Z" },
			});
			const text = email.to("text/plain");
			expect(email.subject).toBe("your Readplace membership starts on Aug 7, 2026");
			expect(text).toContain("— $49.00 charged to the card on file on Aug 7, 2026, then $60 once a year after that.");
			expect(text).toContain("Cancel any time before Aug 7, 2026");
			expect(text).not.toContain("Jul 24, 2026");
		});

		it("states Stripe's amount for a grandfathered plan this build does not sell, with no cadence it cannot name", () => {
			const text = ChargeReminderEmail({
				...baseParams,
				charge: { amountMinor: 4500, currency: "usd", at: baseParams.chargeAt },
			}).to("text/plain");
			expect(text).toContain(
				"— $45.00 charged to the card on file on Jul 24, 2026, then renews automatically at the end of each billing period.",
			);
		});

		it("names no amount for a subscriber grandfathered onto a plan this build no longer sells, because quoting a current plan's price would state a charge they will never see", () => {
			const text = ChargeReminderEmail(baseParams).to("text/plain");
			expect(text).toContain("the plan you are on is charged to the card on file on Jul 24, 2026");
			expect(text).toContain("renews automatically at the end of each billing period");
			expect(text).not.toMatch(/\$\d/);
		});

		it("carries the cancellation path the card networks require — how to cancel, by when, and a link to do it", () => {
			const text = ChargeReminderEmail(baseParams).to("text/plain");
			expect(text).toContain("Cancel any time before Jul 24, 2026 from your account page");
			expect(text).toContain("nothing is charged");
			expect(text).toContain(CTA_URL);
		});

		it("includes the manage-subscription CTA URL with the utm attribution", () => {
			const text = ChargeReminderEmail(baseParams).to("text/plain");
			expect(text).toContain(`Manage your subscription: ${CTA_URL}`);
			expect(text).toContain("utm_source=charge-reminder");
		});

		it("signs off with '— Fayner' and nothing after it", () => {
			const text = ChargeReminderEmail(baseParams).to("text/plain");
			expect(text.trimEnd().endsWith("— Fayner Brack, Founder & CEO")).toBe(true);
		});
	});

	describe("text/html body", () => {
		it("renders the paragraphs, the founder avatar, and the CTA button", () => {
			const html = ChargeReminderEmail(baseParams).to("text/html");
			expect(html).toContain("charged to the card on file on Jul 24, 2026");
			expect(html).toContain("fayner-brack.jpg");
			expect(html).toContain("charge-reminder");
			expect(html).toContain("Manage your subscription");
			expect(html).toContain("— Fayner");
		});
	});
});
