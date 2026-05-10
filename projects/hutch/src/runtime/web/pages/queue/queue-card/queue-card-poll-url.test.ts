import { buildCardPollUrl } from "./queue-card-poll-url";

describe("buildCardPollUrl", () => {
	it("encodes only the poll counter when filters are at their defaults", () => {
		const url = buildCardPollUrl({
			articleId: "abc123",
			pollCount: 1,
			filters: { tab: "queue", page: 1 },
		});
		expect(url).toBe("/queue/abc123/card?poll=1");
	});

	it("preserves the done tab so the card's action redirects stay on the done view", () => {
		const url = buildCardPollUrl({
			articleId: "abc123",
			pollCount: 4,
			filters: { tab: "done", page: 1 },
		});
		expect(url).toBe("/queue/abc123/card?poll=4&tab=done");
	});

	it("omits order when it equals the tab's default order", () => {
		const url = buildCardPollUrl({
			articleId: "abc123",
			pollCount: 1,
			filters: { tab: "queue", order: "desc", page: 1 },
		});
		expect(url).toBe("/queue/abc123/card?poll=1");
	});

	it("includes order when it diverges from the tab default", () => {
		const url = buildCardPollUrl({
			articleId: "abc123",
			pollCount: 2,
			filters: { tab: "queue", order: "asc", page: 1 },
		});
		expect(url).toBe("/queue/abc123/card?poll=2&order=asc");
	});

	it("includes page when the user is past page 1", () => {
		const url = buildCardPollUrl({
			articleId: "abc123",
			pollCount: 1,
			filters: { tab: "queue", page: 3 },
		});
		expect(url).toBe("/queue/abc123/card?poll=1&page=3");
	});
});
