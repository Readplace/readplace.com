import { EPUB_FEATURE_QUERY, epubDownloadHref, revealsEpubDownload } from "./epub-link";

describe("revealsEpubDownload", () => {
	it("reveals the download only for the epub feature value", () => {
		expect(revealsEpubDownload(EPUB_FEATURE_QUERY.value)).toBe(true);
	});

	it("stays hidden without the feature query", () => {
		expect(revealsEpubDownload(undefined)).toBe(false);
	});
});

describe("epubDownloadHref", () => {
	it("appends the epub format and internal utm params to the article's view path", () => {
		const href = epubDownloadHref({ articleUrl: "https://example.com/article", utmSource: "reader" });

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
