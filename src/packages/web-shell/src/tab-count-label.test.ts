import { formatTabCountLabel } from "./tab-count-label";

describe("formatTabCountLabel", () => {
	it("appends the count in parentheses", () => {
		expect(formatTabCountLabel({ label: "To Read", count: 5 })).toBe("To Read (5)");
	});

	it("shows zero rather than hiding it, so 'none' never reads as 'not known yet'", () => {
		expect(formatTabCountLabel({ label: "Skipped", count: 0 })).toBe("Skipped (0)");
	});

	it("keeps the exact count up to the two-digit ceiling", () => {
		expect(formatTabCountLabel({ label: "To Read", count: 99 })).toBe("To Read (99)");
	});

	it("caps counts past the ceiling at 99+", () => {
		expect(formatTabCountLabel({ label: "To Read", count: 100 })).toBe("To Read (99+)");
	});
});
