import {
	TrialFeedbackEmail,
	TRIAL_FEEDBACK_EMAIL_SUBJECT,
} from "./trial-feedback-email";

const baseParams = {
	founderAvatarUrl: "https://readplace.com/fayner-brack.jpg",
	savedArticlesCount: 9,
};

describe("TrialFeedbackEmail", () => {
	describe("subject", () => {
		it("has no exclamation marks and contains exactly one question mark", () => {
			expect(TRIAL_FEEDBACK_EMAIL_SUBJECT).not.toContain("!");
			const questionMarks = TRIAL_FEEDBACK_EMAIL_SUBJECT.match(/\?/g) ?? [];
			expect(questionMarks.length).toBe(1);
		});

		it("opens with 'you tried Readplace' so the recipient sees the research framing in the inbox", () => {
			expect(TRIAL_FEEDBACK_EMAIL_SUBJECT).toContain("you tried Readplace");
			expect(TRIAL_FEEDBACK_EMAIL_SUBJECT).toContain("what was missing?");
		});
	});

	describe("text/plain body — voice and constraints", () => {
		it("contains no exclamation marks", () => {
			const text = TrialFeedbackEmail(baseParams).to("text/plain");
			expect(text).not.toContain("!");
		});

		it("contains exactly one question mark — the single 'what was missing?'", () => {
			const text = TrialFeedbackEmail(baseParams).to("text/plain");
			const questionMarks = text.match(/\?/g) ?? [];
			expect(questionMarks.length).toBe(1);
			expect(text).toContain("what was missing?");
		});

		it("is shorter than 120 words", () => {
			const text = TrialFeedbackEmail(baseParams).to("text/plain");
			const words = text.trim().split(/\s+/);
			expect(words.length).toBeLessThan(120);
		});

		it("signs off with '— Fayner' and nothing after it", () => {
			const text = TrialFeedbackEmail(baseParams).to("text/plain");
			expect(text.trimEnd().endsWith("— Fayner")).toBe(true);
		});

		it("is first-person ('I'/'I'm') and never speaks for the company in plural", () => {
			const text = TrialFeedbackEmail(baseParams).to("text/plain");
			expect(text).toMatch(/\bI'?m\b/);
			expect(text).not.toMatch(/\bwe\b/i);
			expect(text).not.toMatch(/\bour\b/i);
		});

		it("uses the brand name 'Readplace' with the correct casing", () => {
			const text = TrialFeedbackEmail(baseParams).to("text/plain");
			expect(text).toContain("Readplace");
			expect(text).not.toContain("readplace ");
			expect(text).not.toContain("ReadPlace");
		});

		it("contains no links — there's nothing to click", () => {
			const text = TrialFeedbackEmail(baseParams).to("text/plain");
			expect(text).not.toMatch(/https?:\/\//i);
		});

		it("contains no opt-out footer — strict to the research-email spec", () => {
			const text = TrialFeedbackEmail(baseParams).to("text/plain");
			expect(text.toLowerCase()).not.toContain("unsubscribe");
			expect(text.toUpperCase()).not.toContain("REPLY STOP");
		});
	});

	describe("text/plain body — saved-articles personalization", () => {
		it("includes 'saved 9 articles' when the user saved nine", () => {
			const text = TrialFeedbackEmail({ ...baseParams, savedArticlesCount: 9 }).to(
				"text/plain",
			);
			expect(text).toContain("saved 9 articles");
		});

		it("singularises to '1 article' when the user saved one", () => {
			const text = TrialFeedbackEmail({
				...baseParams,
				savedArticlesCount: 1,
			}).to("text/plain");
			expect(text).toContain("saved 1 article");
			expect(text).not.toContain("saved 1 articles");
		});

		it("omits the saved-articles clause entirely when the count is zero", () => {
			const text = TrialFeedbackEmail({
				...baseParams,
				savedArticlesCount: 0,
			}).to("text/plain");
			expect(text).not.toContain("saved");
			expect(text).not.toContain("article");
			expect(text).toContain("You started a trial of Readplace and decided not to continue");
		});
	});

	describe("text/html body", () => {
		it("renders the founder avatar with the absolute URL", () => {
			const html = TrialFeedbackEmail(baseParams).to("text/html");

			expect(html).toContain('src="https://readplace.com/fayner-brack.jpg"');
			expect(html).toContain('alt="Fayner Brack"');
			expect(html).toContain("border-radius:50%");
		});

		it("escapes HTML entities in the avatar URL so a hostile value cannot inject markup", () => {
			const html = TrialFeedbackEmail({
				...baseParams,
				founderAvatarUrl: "https://readplace.com/avatar.jpg?\"'<>&",
			}).to("text/html");

			expect(html).toContain(
				'src="https://readplace.com/avatar.jpg?&quot;&#x27;&lt;&gt;&amp;"',
			);
		});

		it("produces a complete HTML document with the subject in the <title>", () => {
			const html = TrialFeedbackEmail(baseParams).to("text/html");

			expect(html).toContain("<!DOCTYPE html>");
			expect(html).toContain("</html>");
			expect(html).toContain("you tried Readplace");
			expect(html).toContain("what was missing?");
		});

		it("renders the saved-articles clause when count > 0", () => {
			const html = TrialFeedbackEmail({ ...baseParams, savedArticlesCount: 9 }).to(
				"text/html",
			);
			expect(html).toContain("saved 9 articles");
		});

		it("omits the saved-articles clause entirely when count is zero", () => {
			const html = TrialFeedbackEmail({
				...baseParams,
				savedArticlesCount: 0,
			}).to("text/html");
			expect(html).not.toContain("saved");
			expect(html).toContain("You started a trial of Readplace and decided not to continue");
		});

		it("contains the verified copy paragraphs", () => {
			const html = TrialFeedbackEmail(baseParams).to("text/html");
			expect(html).toContain("what was missing?");
			expect(html).toContain("I'm not trying to change your mind");
			expect(html).toContain("The honest answer helps more than a polite one");
			expect(html).toContain("— Fayner");
		});
	});
});
