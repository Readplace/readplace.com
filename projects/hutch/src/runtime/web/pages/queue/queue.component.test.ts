import { emptyStateTitle } from "./queue.component";

describe("emptyStateTitle", () => {
	it("should say nothing was ever saved when the queue holds no articles at all", () => {
		expect(emptyStateTitle({ tab: "queue", queueHoldsArticles: false })).toBe("Nothing saved yet");
	});

	it("should say nothing was ever saved on the Read tab of a queue that holds no articles", () => {
		expect(emptyStateTitle({ tab: "done", queueHoldsArticles: false })).toBe("Nothing saved yet");
	});

	it("should invite the reader to save more on the To Read tab of a worked-through queue", () => {
		expect(emptyStateTitle({ tab: "queue", queueHoldsArticles: true })).toBe(
			"There are no more articles to read",
		);
	});

	it("should report nothing read on the Read tab of a queue whose articles are all unread", () => {
		expect(emptyStateTitle({ tab: "done", queueHoldsArticles: true })).toBe("Nothing read yet");
	});
});
