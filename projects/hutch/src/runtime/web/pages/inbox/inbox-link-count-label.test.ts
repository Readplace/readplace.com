import { buildLinkCountLabel } from "./inbox-link-count-label";

describe("buildLinkCountLabel", () => {
	it("returns undefined when there are no links", () => {
		expect(buildLinkCountLabel({ count: 0, truncated: false })).toBeUndefined();
	});

	it("pluralizes the noun", () => {
		expect(buildLinkCountLabel({ count: 1, truncated: false })).toBe("1 link");
		expect(buildLinkCountLabel({ count: 12, truncated: false })).toBe("12 links");
	});

	it("marks a truncated count with a trailing +", () => {
		expect(buildLinkCountLabel({ count: 200, truncated: true })).toBe("200+ links");
	});
});
