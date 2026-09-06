import { ARTICLE_DOWNLOAD_FORMATS, articleDownloadLinks } from "./epub-link";

describe("articleDownloadLinks", () => {
	it("builds EPUB and AZW3 links with their format-specific attribution", () => {
		const downloads = articleDownloadLinks({ articleUrl: "https://example.com/article", utmSource: "reader" });

		expect(ARTICLE_DOWNLOAD_FORMATS).toEqual(["epub", "azw3"]);
		const epubUrl = new URL(downloads.epubHref, "https://app.test");
		expect(epubUrl.pathname).toBe("/view/example.com/article");
		expect([...epubUrl.searchParams.entries()]).toEqual([
			["format", "epub"],
			["utm_source", "reader"],
			["utm_medium", "internal"],
			["utm_content", "download-epub"],
		]);
		const azw3Url = new URL(downloads.azw3Href, "https://app.test");
		expect([...azw3Url.searchParams.entries()]).toEqual([
			["format", "azw3"],
			["utm_source", "reader"],
			["utm_medium", "internal"],
			["utm_content", "download-azw3"],
		]);
	});
});
