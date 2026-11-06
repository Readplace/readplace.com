import { staleNoticeHtml } from "./stale-notice";

describe("staleNoticeHtml", () => {
	const base = { url: "https://example.com/a", siteName: "Example", hasOrigin: true, kindNoun: undefined };

	it("links to the source by its site name", () => {
		expect(staleNoticeHtml(base)).toBe(
			'Taking a while — <a href="https://example.com/a" target="_blank" rel="noopener">open on Example</a>',
		);
	});

	it("falls back to naming the source when the site has no name", () => {
		expect(staleNoticeHtml({ ...base, siteName: "" })).toContain(">open on the source</a>");
	});

	it("escapes the url and the site name", () => {
		expect(staleNoticeHtml({ ...base, url: 'https://example.com/"a', siteName: "<b>" })).toBe(
			'Taking a while — <a href="https://example.com/&quot;a" target="_blank" rel="noopener">open on &lt;b&gt;</a>',
		);
	});

	it("names the work instead of a link for an item with no origin", () => {
		expect(staleNoticeHtml({ ...base, hasOrigin: false, kindNoun: "book" })).toBe(
			"Taking a while — we're still preparing this book.",
		);
	});

	it("refuses an item with no origin and no kind", () => {
		expect(() => staleNoticeHtml({ ...base, hasOrigin: false })).toThrow("a private item always carries a media kind");
	});
});
