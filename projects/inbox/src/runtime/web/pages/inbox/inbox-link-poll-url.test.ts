import { buildInboxLinkPollUrl } from "./inbox-link-poll-url";

describe("buildInboxLinkPollUrl", () => {
	it("builds the per-card poll path carrying the poll count and page size", () => {
		const url = buildInboxLinkPollUrl({
			emailId: "2026-06-24T09:00:00.000Z#<m@x>",
			ordinal: "0007",
			pollCount: 3,
			shown: 40,
		});

		expect(url).toBe(
			"/inbox/2026-06-24T09%3A00%3A00.000Z%23%3Cm%40x%3E/links/0007/card?poll=3&shown=40",
		);
	});

	it("marks the tick as a save-settle poll so the route budgets it against the shorter cap", () => {
		const url = buildInboxLinkPollUrl({
			emailId: "2026-06-24T09:00:00.000Z#<m@x>",
			ordinal: "0007",
			pollCount: 3,
			shown: 40,
			awaitSave: true,
		});

		expect(url).toBe(
			"/inbox/2026-06-24T09%3A00%3A00.000Z%23%3Cm%40x%3E/links/0007/card?poll=3&shown=40&awaitSave=1",
		);
	});
});
