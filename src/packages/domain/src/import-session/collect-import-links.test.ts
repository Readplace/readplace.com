import { collectImportLinks } from "./collect-import-links";
import { MAX_URLS_PER_IMPORT } from "./import-session.schema";

describe("collectImportLinks", () => {
	it("preserves valid http and https URLs in order", () => {
		const result = collectImportLinks([
			"https://example.com/post",
			"http://example.org/article",
		]);

		expect(result.urls).toEqual([
			"https://example.com/post",
			"http://example.org/article",
		]);
		expect(result.truncated).toBe(false);
	});

	it("dedupes URLs case-insensitively on host and ignores trailing slash on path-only", () => {
		const result = collectImportLinks([
			"https://EXAMPLE.com/",
			"https://example.com",
			"https://example.com/post",
		]);

		expect(result.urls).toEqual([
			"https://EXAMPLE.com/",
			"https://example.com/post",
		]);
	});

	it("preserves URLs with query strings and fragments during normalization", () => {
		const result = collectImportLinks([
			"https://example.com/?q=test",
			"https://example.com/#section",
			"https://example.com/page?a=1#top",
		]);

		expect(result.urls).toEqual([
			"https://example.com/?q=test",
			"https://example.com/#section",
			"https://example.com/page?a=1#top",
		]);
	});

	it("caps the result at MAX_URLS_PER_IMPORT and reports truncation with the total found", () => {
		const urls = Array.from(
			{ length: MAX_URLS_PER_IMPORT + 5 },
			(_v, i) => `https://example.com/post-${i}`,
		);

		const result = collectImportLinks(urls);

		expect(result.urls).toHaveLength(MAX_URLS_PER_IMPORT);
		expect(result.truncated).toBe(true);
		expect(result.totalFound).toBe(MAX_URLS_PER_IMPORT + 5);
	});

	it("returns an empty result when given no URLs", () => {
		const result = collectImportLinks([]);

		expect(result.urls).toEqual([]);
		expect(result.truncated).toBe(false);
		expect(result.totalFound).toBe(0);
	});

	it("rejects non-saveable schemes and bare strings", () => {
		const result = collectImportLinks([
			"mailto:foo@bar.com",
			"javascript:alert(1)",
			"chrome://settings",
			"about:blank",
			"data:text/html,<h1>x</h1>",
			"file:///etc/passwd",
			"/relative/path",
			"https://example.com/keep",
		]);

		expect(result.urls).toEqual(["https://example.com/keep"]);
	});

	it("skips entries that fail URL parsing", () => {
		const result = collectImportLinks(["http://", "not-a-url", "https://example.com/ok"]);

		expect(result.urls).toEqual(["https://example.com/ok"]);
	});
});
