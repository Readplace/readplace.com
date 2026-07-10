import { etagMatches } from "./etag";

describe("etagMatches", () => {
	it("returns false for an undefined If-None-Match header", () => {
		expect(etagMatches(undefined, 'W/"abc"')).toBe(false);
	});

	it("matches an exact single ETag", () => {
		expect(etagMatches('W/"abc"', 'W/"abc"')).toBe(true);
	});

	it("matches when the header carries multiple ETags", () => {
		expect(etagMatches('W/"abc", W/"def"', 'W/"def"')).toBe(true);
	});

	it("does not match when no entry equals the ETag", () => {
		expect(etagMatches('W/"abc"', 'W/"xyz"')).toBe(false);
	});
});
