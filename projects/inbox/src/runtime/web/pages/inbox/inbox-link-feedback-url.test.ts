import { buildInboxLinkFeedbackUrl } from "./inbox-link-feedback-url";

describe("buildInboxLinkFeedbackUrl", () => {
	it("targets the link's feedback route with the email id encoded and the feature flag carried", () => {
		expect(
			buildInboxLinkFeedbackUrl({ emailId: "2026-06-24T09:00:00.000Z#<m@x>", ordinal: "0003" }),
		).toBe(
			"/inbox/2026-06-24T09%3A00%3A00.000Z%23%3Cm%40x%3E/links/0003/feedback?feature=email",
		);
	});
});
