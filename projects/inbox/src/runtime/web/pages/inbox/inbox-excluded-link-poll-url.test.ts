import { buildInboxExcludedLinkPollUrl } from "./inbox-excluded-link-poll-url";

describe("buildInboxExcludedLinkPollUrl", () => {
	it("builds this row's own fragment path carrying the poll count", () => {
		const url = buildInboxExcludedLinkPollUrl({
			emailId: "2026-06-24T09:00:00.000Z#<m@x>",
			ordinal: "0003",
			pollCount: 2,
		});

		expect(url).toBe(
			"/inbox/2026-06-24T09%3A00%3A00.000Z%23%3Cm%40x%3E/links/0003/excluded?poll=2",
		);
	});
});
