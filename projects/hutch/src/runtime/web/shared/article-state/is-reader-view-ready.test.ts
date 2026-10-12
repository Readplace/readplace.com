import { isReaderViewReady } from "./is-reader-view-ready";

describe("isReaderViewReady", () => {
	it("is ready when the crawl is ready and the content is present", () => {
		expect(isReaderViewReady({ crawl: { status: "ready" }, content: "<p>Body copy</p>" })).toBe(true);
	});

	it("is ready for a legacy row with content and no crawl record", () => {
		expect(isReaderViewReady({ crawl: undefined, content: "<p>Body copy</p>" })).toBe(true);
	});

	it("is not ready while the crawl is pending, even with published content", () => {
		expect(isReaderViewReady({ crawl: { status: "pending" }, content: "<p>Body copy</p>" })).toBe(
			false,
		);
	});

	it("is not ready when the crawl is ready but the content has not landed", () => {
		expect(isReaderViewReady({ crawl: { status: "ready" }, content: undefined })).toBe(false);
	});
});
