import type { CrawlArticle, CrawlArticleResult, ThumbnailImage } from "@packages/crawl-article";
import { initCrawlAndFinalizeArticle } from "./crawl-and-finalize-article";
import type { FinalizeArticle, FinalizedArticle } from "./finalize-article";

const URL_UNDER_TEST = "https://example.com/article";

const stubFinalizedArticle: FinalizedArticle = {
	html: "<p>processed</p>",
	metadata: {
		title: "T",
		siteName: "example.com",
		excerpt: "e",
		wordCount: 100,
		estimatedReadTime: 1,
		imageUrl: "https://cdn.example.com/content/x/images/abc.jpg",
	},
};

const okFinalize: FinalizeArticle = async () => ({ ok: true, article: stubFinalizedArticle });

describe("initCrawlAndFinalizeArticle", () => {
	it("calls crawlArticle with fetchThumbnail:true on every invocation (no opt-in flag per caller)", async () => {
		const crawlArticle = jest.fn<Promise<CrawlArticleResult>, Parameters<CrawlArticle>>(async () => ({
			status: "fetched",
			html: "<html></html>",
			bodyHash: "a".repeat(64),
		}));
		const crawlAndFinalize = initCrawlAndFinalizeArticle({
			crawlArticle,
			finalizeArticle: okFinalize,
		});

		await crawlAndFinalize({ url: URL_UNDER_TEST });

		expect(crawlArticle).toHaveBeenCalledWith(expect.objectContaining({
			url: URL_UNDER_TEST,
			fetchThumbnail: true,
		}));
	});

	it("forwards previousBodyHash through to the crawler so the byte-gate fires when the origin returns the same body under 200 OK", async () => {
		const crawlArticle = jest.fn<Promise<CrawlArticleResult>, Parameters<CrawlArticle>>(async () => ({
			status: "not-modified",
		}));
		const crawlAndFinalize = initCrawlAndFinalizeArticle({
			crawlArticle,
			finalizeArticle: okFinalize,
		});

		await crawlAndFinalize({ url: URL_UNDER_TEST, previousBodyHash: "h".repeat(64) });

		expect(crawlArticle).toHaveBeenCalledWith(expect.objectContaining({
			previousBodyHash: "h".repeat(64),
		}));
	});

	it("forwards etag and lastModified so the crawler can short-circuit to not-modified (stale-check path)", async () => {
		const crawlArticle = jest.fn<Promise<CrawlArticleResult>, Parameters<CrawlArticle>>(async () => ({
			status: "not-modified",
		}));
		const crawlAndFinalize = initCrawlAndFinalizeArticle({
			crawlArticle,
			finalizeArticle: okFinalize,
		});

		await crawlAndFinalize({
			url: URL_UNDER_TEST,
			etag: '"abc"',
			lastModified: "Wed, 01 Apr 2026 00:00:00 GMT",
		});

		expect(crawlArticle).toHaveBeenCalledWith(expect.objectContaining({
			etag: '"abc"',
			lastModified: "Wed, 01 Apr 2026 00:00:00 GMT",
		}));
	});

	it("maps the crawler's not-modified status through to the caller (stale-check uses this to publish UpdateFetchTimestamp)", async () => {
		const crawlAndFinalize = initCrawlAndFinalizeArticle({
			crawlArticle: async () => ({ status: "not-modified" }),
			finalizeArticle: okFinalize,
		});

		const result = await crawlAndFinalize({ url: URL_UNDER_TEST });

		expect(result).toEqual({ status: "not-modified" });
	});

	it("maps the crawler's unsupported status through with the reason (save-link-work defers to comprehensive crawl)", async () => {
		const crawlAndFinalize = initCrawlAndFinalizeArticle({
			crawlArticle: async () => ({ status: "unsupported", reason: "unsupported content type: application/pdf" }),
			finalizeArticle: okFinalize,
		});

		const result = await crawlAndFinalize({ url: URL_UNDER_TEST });

		expect(result).toEqual({
			status: "unsupported",
			reason: "unsupported content type: application/pdf",
		});
	});

	it("maps the crawler's failed status to status:failed with a stable reason", async () => {
		const crawlAndFinalize = initCrawlAndFinalizeArticle({
			crawlArticle: async () => ({ status: "failed" }),
			finalizeArticle: okFinalize,
		});

		const result = await crawlAndFinalize({ url: URL_UNDER_TEST });

		expect(result).toEqual({ status: "failed", reason: "crawl-failed" });
	});

	it("threads the crawler's pre-fetched thumbnailImage into finalizeArticle so no second image fetch fires", async () => {
		const preFetched: ThumbnailImage = {
			body: Buffer.from([0xff, 0xd8, 0xff]),
			contentType: "image/jpeg",
			url: "https://example.com/og.jpg",
			extension: ".jpg",
		};
		const finalizeArticle = jest.fn(okFinalize);
		const crawlAndFinalize = initCrawlAndFinalizeArticle({
			crawlArticle: async () => ({
				status: "fetched",
				html: "<html></html>",
				thumbnailUrl: "https://example.com/og.jpg",
				thumbnailImage: preFetched,
				bodyHash: "a".repeat(64),
			}),
			finalizeArticle,
		});

		await crawlAndFinalize({ url: URL_UNDER_TEST });

		expect(finalizeArticle).toHaveBeenCalledWith({
			url: URL_UNDER_TEST,
			html: "<html></html>",
			preFetchedThumbnail: preFetched,
		});
	});

	it("returns the finalizer's parse failure verbatim so callers can drive the markCrawlFailed transition", async () => {
		const crawlAndFinalize = initCrawlAndFinalizeArticle({
			crawlArticle: async () => ({ status: "fetched", html: "<html></html>", bodyHash: "a".repeat(64) }),
			finalizeArticle: async () => ({ ok: false, reason: "readability crashed" }),
		});

		const result = await crawlAndFinalize({ url: URL_UNDER_TEST });

		expect(result).toEqual({ status: "failed", reason: "readability crashed" });
	});

	it("returns the finalized article + freshness headers and bodyHash on success so callers persist them", async () => {
		const crawlAndFinalize = initCrawlAndFinalizeArticle({
			crawlArticle: async () => ({
				status: "fetched",
				html: "<html></html>",
				etag: '"v1"',
				lastModified: "Wed, 01 Apr 2026 00:00:00 GMT",
				bodyHash: "deadbeef".repeat(8),
			}),
			finalizeArticle: okFinalize,
		});

		const result = await crawlAndFinalize({ url: URL_UNDER_TEST });

		expect(result).toEqual({
			status: "fetched",
			article: stubFinalizedArticle,
			etag: '"v1"',
			lastModified: "Wed, 01 Apr 2026 00:00:00 GMT",
			bodyHash: "deadbeef".repeat(8),
		});
	});
});
