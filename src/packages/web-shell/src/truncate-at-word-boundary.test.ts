import { truncateAtWordBoundary } from "./truncate-at-word-boundary";

describe("truncateAtWordBoundary", () => {
	it("returns text under the limit unchanged", () => {
		expect(truncateAtWordBoundary("short text", 20)).toBe("short text");
	});

	it("returns text exactly at the limit unchanged", () => {
		expect(truncateAtWordBoundary("ten chars!", 10)).toBe("ten chars!");
	});

	it("cuts at the last word boundary and appends an ellipsis", () => {
		expect(truncateAtWordBoundary("the quick brown fox jumps", 15)).toBe("the quick…");
	});

	it("hard-cuts a single word that has no boundary to cut at", () => {
		expect(truncateAtWordBoundary("abcdefghijklmnop", 8)).toBe("abcdefg…");
	});

	it("trims whitespace left before the ellipsis", () => {
		expect(truncateAtWordBoundary("one   two three", 9)).toBe("one…");
	});
});
