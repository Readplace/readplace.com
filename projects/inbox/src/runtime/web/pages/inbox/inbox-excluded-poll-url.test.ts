import { buildInboxExcludedPollUrl } from "./inbox-excluded-poll-url";

describe("buildInboxExcludedPollUrl", () => {
	it("builds the panel poll path carrying the poll count", () => {
		const url = buildInboxExcludedPollUrl({
			emailId: "2026-06-24T09:00:00.000Z#<m@x>",
			pollCount: 2,
		});

		expect(url).toBe(
			"/inbox/2026-06-24T09%3A00%3A00.000Z%23%3Cm%40x%3E/excluded?poll=2",
		);
	});
});
