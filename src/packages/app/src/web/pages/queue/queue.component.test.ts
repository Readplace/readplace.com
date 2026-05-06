import { formatUnreadLabel } from "./queue.component";

describe("formatUnreadLabel", () => {
	it("should format zero count", () => {
		expect(formatUnreadLabel(0)).toBe("To read (0)");
	});

	it("should format normal count", () => {
		expect(formatUnreadLabel(5)).toBe("To read (5)");
	});

	it("should format count at boundary", () => {
		expect(formatUnreadLabel(99)).toBe("To read (99)");
	});

	it("should cap at 99+ when count exceeds 99", () => {
		expect(formatUnreadLabel(100)).toBe("To read (99+)");
	});
});
