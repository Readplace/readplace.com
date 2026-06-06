import { extractNewsletterLinks } from "./extract-newsletter-links";

describe("extractNewsletterLinks", () => {
	it("harvests anchor hrefs and bare text URLs, de-duplicated", () => {
		const html = [
			'<a href="https://example.com/post-1">Read</a>',
			"<p>Also see https://example.com/post-2 today.</p>",
			'<a href="https://example.com/post-1">Read again</a>',
		].join("");

		const result = extractNewsletterLinks({ html });

		expect(result.urls).toEqual([
			"https://example.com/post-1",
			"https://example.com/post-2",
		]);
	});

	it("returns no links for a body without URLs", () => {
		const result = extractNewsletterLinks({ html: "<p>No links here.</p>" });
		expect(result.urls).toEqual([]);
		expect(result.totalFound).toBe(0);
	});
});
