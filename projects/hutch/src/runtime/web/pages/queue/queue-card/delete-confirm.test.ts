import { deleteConfirmPopoverId, toDeleteConfirmDisplayModel } from "./delete-confirm";

describe("deleteConfirmPopoverId", () => {
	it("prefixes the hash so the id is a legal CSS ident, not just a legal HTML id", () => {
		const popoverId = deleteConfirmPopoverId("1a2b3c4d5e6f70819a2b3c4d5e6f7081");

		expect(popoverId).toBe("queue-delete-confirm-1a2b3c4d5e6f70819a2b3c4d5e6f7081");
		expect(popoverId).toMatch(/^[a-zA-Z_-]/);
	});
});

describe("toDeleteConfirmDisplayModel", () => {
	it("stamps the same internal tracking the card's delete form carries", () => {
		const display = toDeleteConfirmDisplayModel({
			articleId: "abc123",
			popoverId: "queue-delete-confirm-abc123",
			url: "/queue/abc123/delete",
		});

		expect(display.url).toContain("utm_source=queue-card");
		expect(display.url).toContain("utm_medium=internal");
		expect(display.url).toContain("utm_content=delete");
	});

	it("preserves the return query so confirming keeps the reader on the same view", () => {
		const display = toDeleteConfirmDisplayModel({
			articleId: "abc123",
			popoverId: "queue-delete-confirm-abc123",
			url: "/queue/abc123/delete?tab=done&order=asc",
		});

		expect(display.url).toContain("tab=done");
		expect(display.url).toContain("order=asc");
		expect(display.articleId).toBe("abc123");
		expect(display.popoverId).toBe("queue-delete-confirm-abc123");
	});
});
