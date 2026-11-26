import { emailTrackedUrl } from "./email-tracked-url";

describe("emailTrackedUrl", () => {
	it("stamps source, the email medium, campaign, content and term in that order after the link's own params", () => {
		expect(
			emailTrackedUrl({
				url: "https://readplace.com/queue?token=abc",
				source: "queue-digest",
				campaign: "weekly",
				content: "open",
				term: "send-1",
			}),
		).toBe(
			"https://readplace.com/queue?token=abc&utm_source=queue-digest&utm_medium=email&utm_campaign=weekly&utm_content=open&utm_term=send-1",
		);
	});

	it("leaves out the campaign and term when the email has none", () => {
		expect(
			emailTrackedUrl({ url: new URL("https://readplace.com/reset"), source: "password-reset-email", content: "reset-password" }),
		).toBe("https://readplace.com/reset?utm_source=password-reset-email&utm_medium=email&utm_content=reset-password");
	});
});
