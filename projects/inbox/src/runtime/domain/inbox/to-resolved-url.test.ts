import { toResolvedUrl } from "./to-resolved-url";

describe("toResolvedUrl", () => {
	it("returns undefined when the crawl produced no terminal URL (site-rule/oembed path)", () => {
		expect(toResolvedUrl({ url: "https://example.com/post", finalUrl: undefined })).toBeUndefined();
	});

	it("returns undefined when the fetch landed exactly where the link pointed", () => {
		expect(
			toResolvedUrl({ url: "https://example.com/post", finalUrl: "https://example.com/post" }),
		).toBeUndefined();
	});

	it("keeps an anchored direct link intact: a terminal differing only by the dropped #fragment resolves nothing", () => {
		expect(
			toResolvedUrl({
				url: "https://blog.example.com/post#pricing",
				finalUrl: "https://blog.example.com/post",
			}),
		).toBeUndefined();
	});

	it("treats a serialization-only difference (trailing slash on a bare origin) as the same place", () => {
		expect(
			toResolvedUrl({ url: "https://example.com", finalUrl: "https://example.com/" }),
		).toBeUndefined();
	});

	it("returns the destination when a tracking link redirected somewhere else", () => {
		expect(
			toResolvedUrl({
				url: "https://nodeweekly.com/link/187980/4be0b3f821",
				finalUrl: "https://destination.test/the-actual-article",
			}),
		).toBe("https://destination.test/the-actual-article");
	});

	it("preserves a fragment the redirect destination itself carries", () => {
		expect(
			toResolvedUrl({
				url: "https://nodeweekly.com/link/187980/4be0b3f821",
				finalUrl: "https://destination.test/changelog#22-x",
			}),
		).toBe("https://destination.test/changelog#22-x");
	});
});
