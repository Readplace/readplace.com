import { httpErrorMessageMapping } from "./queue.error";

describe("httpErrorMessageMapping", () => {
	it("returns undefined when error_code is absent", () => {
		expect(httpErrorMessageMapping({})).toBeUndefined();
	});

	it("returns undefined when error_code is not a string", () => {
		expect(httpErrorMessageMapping({ error_code: 42 })).toBeUndefined();
	});

	it("returns undefined for an unknown error code", () => {
		expect(httpErrorMessageMapping({ error_code: "something_else" })).toBeUndefined();
	});

	it("returns the mapped message for save_failed", () => {
		expect(httpErrorMessageMapping({ error_code: "save_failed" })).toBe("Could not save article. Please try again.");
	});
});
