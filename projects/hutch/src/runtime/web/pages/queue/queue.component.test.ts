import { emptyStateTitle, formatUnreadLabel } from "./queue.component";

describe("formatUnreadLabel", () => {
	it("should format zero count", () => {
		expect(formatUnreadLabel(0)).toBe("To Read (0)");
	});

	it("should format normal count", () => {
		expect(formatUnreadLabel(5)).toBe("To Read (5)");
	});

	it("should format count at boundary", () => {
		expect(formatUnreadLabel(99)).toBe("To Read (99)");
	});

	it("should cap at 99+ when count exceeds 99", () => {
		expect(formatUnreadLabel(100)).toBe("To Read (99+)");
	});
});

describe("emptyStateTitle", () => {
	it("should invite the reader to save more on the To Read tab", () => {
		expect(emptyStateTitle("queue")).toBe("There are no more articles to read");
	});

	it("should describe an empty Read tab", () => {
		expect(emptyStateTitle("done")).toBe("Your queue is empty");
	});
});
