import { buildInboxLinkPollUrl } from "./inbox-link-poll-url";

describe("buildInboxLinkPollUrl", () => {
	it("builds the per-card poll path carrying the feature flag and poll count", () => {
		const url = buildInboxLinkPollUrl({
			emailId: "2026-06-24T09:00:00.000Z#<m@x>",
			ordinal: "0007",
			pollCount: 3,
		});

		expect(url).toBe(
			"/inbox/2026-06-24T09%3A00%3A00.000Z%23%3Cm%40x%3E/links/0007/card?feature=email&poll=3",
		);
	});
});
