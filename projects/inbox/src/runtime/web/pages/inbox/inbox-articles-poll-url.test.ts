import { buildInboxArticlesPollUrl } from "./inbox-articles-poll-url";

describe("buildInboxArticlesPollUrl", () => {
	it("builds the panel poll path carrying the poll count", () => {
		const url = buildInboxArticlesPollUrl({
			emailId: "2026-06-24T09:00:00.000Z#<m@x>",
			pollCount: 2,
		});

		expect(url).toBe(
			"/inbox/2026-06-24T09%3A00%3A00.000Z%23%3Cm%40x%3E/articles?poll=2",
		);
	});
});
