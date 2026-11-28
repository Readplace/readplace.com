import { articleSharingFor } from "./article-sharing";

const APP_ORIGIN = "https://readplace.com";

describe("articleSharingFor", () => {
	it("shares only the quote of an email issue, whose URL names the reader", () => {
		expect(
			articleSharingFor({
				articleUrl: "email://inbox/owner/2026-06-24T09%3A00%3A00.000Z%23%3Cm%40x%3E",
				originalUrl: "email://inbox/owner/2026-06-24T09%3A00%3A00.000Z%23%3Cm%40x%3E",
				appOrigin: APP_ORIGIN,
				readerViewShareable: true,
			}),
		).toEqual({ kind: "quote-only", reason: "email-issue" });
	});

	it("shares only the quote of a private upload", () => {
		expect(
			articleSharingFor({
				articleUrl: "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef",
				originalUrl: "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef",
				appOrigin: APP_ORIGIN,
				readerViewShareable: true,
			}),
		).toEqual({ kind: "quote-only", reason: "private-upload" });
	});

	it("links the /view page when the reader view is shareable", () => {
		expect(
			articleSharingFor({
				articleUrl: "https://example.com/post",
				originalUrl: "https://example.com/post?ref=1",
				appOrigin: APP_ORIGIN,
				readerViewShareable: true,
			}),
		).toEqual({ kind: "view", url: "https://readplace.com/view/example.com/post" });
	});

	it("links the original when the reader view is not shareable", () => {
		expect(
			articleSharingFor({
				articleUrl: "https://example.com/post",
				originalUrl: "https://example.com/post?ref=1",
				appOrigin: APP_ORIGIN,
				readerViewShareable: false,
			}),
		).toEqual({ kind: "original", url: "https://example.com/post?ref=1" });
	});
});
