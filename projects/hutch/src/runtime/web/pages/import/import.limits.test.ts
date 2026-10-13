import { IMPORT_LIMITS } from "./import.limits";

describe("IMPORT_LIMITS", () => {
	it("names the link cap with its thousands separator", () => {
		expect(IMPORT_LIMITS.maxLinks).toBe("2,000");
	});

	it("floors the file cap to one decimal megabyte, so the page never promises more than the upload accepts", () => {
		expect(IMPORT_LIMITS.maxFileSize).toBe("4.5 MB");
	});
});
