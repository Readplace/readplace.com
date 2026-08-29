import { emptyStateTitle } from "./readlist.component";

describe("emptyStateTitle", () => {
	it("should say nothing was ever saved when the readlist holds no articles at all", () => {
		expect(emptyStateTitle({ tab: "queue", readlistHoldsArticles: false })).toBe("Nothing saved yet");
	});

	it("should say nothing was ever saved on the Read tab of a readlist that holds no articles", () => {
		expect(emptyStateTitle({ tab: "done", readlistHoldsArticles: false })).toBe("Nothing saved yet");
	});

	it("should invite the reader to save more on the To Read tab of a worked-through readlist", () => {
		expect(emptyStateTitle({ tab: "queue", readlistHoldsArticles: true })).toBe(
			"There are no more articles to read",
		);
	});

	it("should report nothing read on the Read tab of a readlist whose articles are all unread", () => {
		expect(emptyStateTitle({ tab: "done", readlistHoldsArticles: true })).toBe("Nothing read yet");
	});
});
