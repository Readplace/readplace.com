import { articleEpubHref } from "./epub-link";

describe("articleEpubHref", () => {
	it("builds the EPUB download link with its attribution", () => {
		const href = articleEpubHref({ articleUrl: "https://example.com/article", utmSource: "reader" });

		const url = new URL(href, "https://app.test");
		expect(url.pathname).toBe("/view/example.com/article");
		expect([...url.searchParams.entries()]).toEqual([
			["format", "epub"],
			["utm_source", "reader"],
			["utm_medium", "internal"],
			["utm_content", "download-epub"],
		]);
	});
});
