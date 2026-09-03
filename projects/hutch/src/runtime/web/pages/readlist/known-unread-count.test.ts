import { deriveKnownUnreadCount } from "./known-unread-count";

describe("deriveKnownUnreadCount", () => {
	it("is zero when the readlist holds nothing at all", () => {
		expect(
			deriveKnownUnreadCount({
				tab: "queue",
				hasMore: false,
				page: 1,
				pageSize: 20,
				rowsOnPage: 0,
				readlistHoldsArticles: false,
			}),
		).toBe(0);
	});

	it("counts the rows on the only page of the queue tab", () => {
		expect(
			deriveKnownUnreadCount({
				tab: "queue",
				hasMore: false,
				page: 1,
				pageSize: 20,
				rowsOnPage: 2,
				readlistHoldsArticles: true,
			}),
		).toBe(2);
	});

	it("adds the full earlier pages to the rows on the last page", () => {
		expect(
			deriveKnownUnreadCount({
				tab: "queue",
				hasMore: false,
				page: 2,
				pageSize: 20,
				rowsOnPage: 5,
				readlistHoldsArticles: true,
			}),
		).toBe(25);
	});

	it("stays unknown while the queue tab spills onto another page", () => {
		expect(
			deriveKnownUnreadCount({
				tab: "queue",
				hasMore: true,
				page: 1,
				pageSize: 20,
				rowsOnPage: 20,
				readlistHoldsArticles: true,
			}),
		).toBeUndefined();
	});

	it("stays unknown on the Read tab, where the count describes different rows", () => {
		expect(
			deriveKnownUnreadCount({
				tab: "done",
				hasMore: false,
				page: 1,
				pageSize: 20,
				rowsOnPage: 3,
				readlistHoldsArticles: true,
			}),
		).toBeUndefined();
	});

	it("is zero for an all-read queue whose first unread page is empty", () => {
		expect(
			deriveKnownUnreadCount({
				tab: "queue",
				hasMore: false,
				page: 1,
				pageSize: 20,
				rowsOnPage: 0,
				readlistHoldsArticles: true,
			}),
		).toBe(0);
	});

	it("stays unknown for an over-bounds page so a stale card swap never paints an inflated count", () => {
		expect(
			deriveKnownUnreadCount({
				tab: "queue",
				hasMore: false,
				page: 2,
				pageSize: 20,
				rowsOnPage: 0,
				readlistHoldsArticles: true,
			}),
		).toBeUndefined();
	});
});
