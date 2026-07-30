import { emptyStateTitle } from "./queue.component";

describe("emptyStateTitle", () => {
	it("should invite the reader to save more on the To Read tab", () => {
		expect(emptyStateTitle("queue")).toBe("There are no more articles to read");
	});

	it("should describe an empty Read tab", () => {
		expect(emptyStateTitle("done")).toBe("Your queue is empty");
	});
});
