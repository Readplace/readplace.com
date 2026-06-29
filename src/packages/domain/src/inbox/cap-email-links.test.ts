import type { ImportLinksResult } from "../import-session";
import { capEmailLinks } from "./cap-email-links";

const result = (over: Partial<ImportLinksResult>): ImportLinksResult => ({
	urls: [],
	truncated: false,
	totalFound: 0,
	...over,
});

describe("capEmailLinks", () => {
	it("passes an under-cap result through unchanged and preserves truncated=false", () => {
		const capped = capEmailLinks(
			result({ urls: ["https://a.test", "https://b.test"], totalFound: 2 }),
			{ maxLinks: 200 },
		);

		expect(capped.urls).toEqual(["https://a.test", "https://b.test"]);
		expect(capped.truncated).toBe(false);
	});

	it("slices to maxLinks and marks truncated when over the per-email soft cap", () => {
		const urls = Array.from({ length: 205 }, (_v, i) => `https://example.com/post-${i}`);

		const capped = capEmailLinks(result({ urls, totalFound: 205 }), { maxLinks: 200 });

		expect(capped.urls).toHaveLength(200);
		expect(capped.urls[199]).toBe("https://example.com/post-199");
		expect(capped.truncated).toBe(true);
	});

	it("propagates a hard-cap truncation even when the result is under the soft cap", () => {
		const capped = capEmailLinks(
			result({ urls: ["https://a.test"], truncated: true, totalFound: 2001 }),
			{ maxLinks: 200 },
		);

		expect(capped.urls).toEqual(["https://a.test"]);
		expect(capped.truncated).toBe(true);
	});
});
