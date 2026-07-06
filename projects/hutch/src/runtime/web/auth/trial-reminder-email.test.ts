import {
	TrialReminderEmail,
	TRIAL_REMINDER_EMAIL_SUBJECT,
} from "./trial-reminder-email";

const CTA_URL =
	"https://readplace.com/account?utm_source=trial-reminder&utm_medium=email&utm_campaign=trial-preexpiry";

const baseParams = {
	founderAvatarUrl: "https://readplace.com/fayner-brack.jpg",
	savedArticlesCount: 9,
	ctaUrl: CTA_URL,
};

describe("TrialReminderEmail", () => {
	describe("subject", () => {
		it("names the two-day lead time and carries no exclamation marks", () => {
			expect(TRIAL_REMINDER_EMAIL_SUBJECT).toBe(
				"your Readplace trial ends in 2 days",
			);
			expect(TRIAL_REMINDER_EMAIL_SUBJECT).not.toContain("!");
		});
	});

	describe("text/plain body", () => {
		it("contains no exclamation marks and is first-person", () => {
			const text = TrialReminderEmail(baseParams).to("text/plain");
			expect(text).not.toContain("!");
			expect(text).toMatch(/\bI\b/);
			expect(text).not.toMatch(/\bwe\b/i);
		});

		it("includes the subscribe CTA URL with the utm attribution", () => {
			const text = TrialReminderEmail(baseParams).to("text/plain");
			expect(text).toContain(`Subscribe: ${CTA_URL}`);
			expect(text).toContain("utm_source=trial-reminder");
		});

		it("signs off with '— Fayner' and nothing after it", () => {
			const text = TrialReminderEmail(baseParams).to("text/plain");
			expect(text.trimEnd().endsWith("— Fayner")).toBe(true);
		});

		it("mentions the saved-articles reassurance when count > 0", () => {
			const text = TrialReminderEmail({ ...baseParams, savedArticlesCount: 9 }).to(
				"text/plain",
			);
			expect(text).toContain("the 9 articles you've saved stay readable either way");
		});

		it("singularises to '1 article' when the user saved one", () => {
			const text = TrialReminderEmail({ ...baseParams, savedArticlesCount: 1 }).to(
				"text/plain",
			);
			expect(text).toContain("the 1 article you've saved stay readable either way");
		});

		it("omits the saved-articles clause entirely when count is zero", () => {
			const text = TrialReminderEmail({ ...baseParams, savedArticlesCount: 0 }).to(
				"text/plain",
			);
			expect(text).not.toContain("stay readable either way");
			expect(text).toContain("your account goes read-only.");
		});
	});

	describe("text/html body", () => {
		it("renders the founder avatar with the absolute URL", () => {
			const html = TrialReminderEmail(baseParams).to("text/html");
			expect(html).toContain('src="https://readplace.com/fayner-brack.jpg"');
			expect(html).toContain('alt="Fayner Brack"');
		});

		it("renders the subscribe CTA button pointing at the ctaUrl", () => {
			const html = TrialReminderEmail(baseParams).to("text/html");
			// Handlebars entity-escapes '=' (→ &#x3D;) and '&' (→ &amp;) inside the
			// href; the recipient's client decodes them back to the real URL.
			expect(html).toContain("readplace.com/account?utm_source");
			expect(html).toContain("trial-reminder");
			expect(html).toContain("trial-preexpiry");
			expect(html).toContain(">Keep using Readplace</a>");
		});

		it("produces a complete HTML document with the trial-ends title", () => {
			const html = TrialReminderEmail(baseParams).to("text/html");
			expect(html).toContain("<!DOCTYPE html>");
			expect(html).toContain("</html>");
			expect(html).toContain("Your Readplace trial ends soon");
		});

		it("omits the saved-articles clause entirely when count is zero", () => {
			const html = TrialReminderEmail({ ...baseParams, savedArticlesCount: 0 }).to(
				"text/html",
			);
			expect(html).not.toContain("stay readable either way");
		});
	});
});
