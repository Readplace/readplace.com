import { articleEpubHref } from "./epub-link";

describe("articleEpubHref", () => {
	it("builds the EPUB download link with its attribution", () => {
		const href = articleEpubHref({
			articleUrl: "https://example.com/article",
			utmSource: "reader",
			appClient: undefined,
		});

		const url = new URL(href, "https://app.test");
		expect(url.pathname).toBe("/view/example.com/article");
		expect([...url.searchParams.entries()]).toEqual([
			["format", "epub"],
			["utm_source", "reader"],
			["utm_medium", "internal"],
			["utm_content", "download-epub"],
		]);
	});

	it("attributes a download rendered in the iOS app to that app", () => {
		const href = articleEpubHref({
			articleUrl: "https://example.com/article",
			utmSource: "reader",
			appClient: "ios_app",
		});

		const url = new URL(href, "https://app.test");
		expect(url.pathname).toBe("/view/example.com/article");
		expect([...url.searchParams.entries()]).toEqual([
			["format", "epub"],
			["utm_source", "reader"],
			["utm_medium", "internal"],
			["utm_content", "download-epub"],
			["utm_term", "ios_app"],
		]);
	});
});
