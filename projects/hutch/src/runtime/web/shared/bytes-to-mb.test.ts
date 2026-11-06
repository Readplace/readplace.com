import { megabytesLabel } from "./bytes-to-mb";

describe("megabytesLabel", () => {
	it("labels a whole number of megabytes without a decimal", () => {
		expect(megabytesLabel(20 * 1024 * 1024)).toBe("20 MB");
	});

	it("labels a fractional number of megabytes with one decimal", () => {
		expect(megabytesLabel(4_718_592)).toBe("4.5 MB");
	});

	it("rounds to one decimal place", () => {
		expect(megabytesLabel(3 * 1024 * 1024 + 100_000)).toBe("3.1 MB");
	});
});
