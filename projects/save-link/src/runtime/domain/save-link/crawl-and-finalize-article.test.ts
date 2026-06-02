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
			crawlArticle: async () => ({ status: "fetched", html: "<html></html>" }),
			finalizeArticle: async () => ({ ok: false, reason: "readability crashed" }),
		});

		const result = await crawlAndFinalize({ url: URL_UNDER_TEST });

		expect(result).toEqual({ status: "failed", reason: "readability crashed" });
	});

	it("returns the finalized article + freshness headers on success so callers persist etag/lastModified", async () => {
		const crawlAndFinalize = initCrawlAndFinalizeArticle({
			crawlArticle: async () => ({
				status: "fetched",
				html: "<html></html>",
				etag: '"v1"',
				lastModified: "Wed, 01 Apr 2026 00:00:00 GMT",
			}),
			finalizeArticle: okFinalize,
		});

		const result = await crawlAndFinalize({ url: URL_UNDER_TEST });

		expect(result).toEqual({
			status: "fetched",
			article: stubFinalizedArticle,
			etag: '"v1"',
			lastModified: "Wed, 01 Apr 2026 00:00:00 GMT",
		});
	});

	it("forwards onPartialHtml to crawlArticle so the PDF extractor can stream Tesseract pages", async () => {
		const partials: Array<{ html: string; readyPageCount: number }> = [];
		const crawlArticle = jest.fn<Promise<CrawlArticleResult>, Parameters<CrawlArticle>>(async ({ onPartialHtml }) => {
			if (onPartialHtml) onPartialHtml({ html: "<p>page 1</p>", readyPageCount: 1 });
			return { status: "fetched", html: "<html><head><title>T</title></head><body><p>HTML body</p></body></html>" };
		});
		const crawlAndFinalize = initCrawlAndFinalizeArticle({
			crawlArticle,
			finalizeArticle: okFinalize,
		});

		await crawlAndFinalize({
			url: URL_UNDER_TEST,
			onPartialHtml: (p) => { partials.push(p); },
		});

		// PDF Tesseract emission survived the threading.
		expect(partials.some((p) => p.html === "<p>page 1</p>" && p.readyPageCount === 1)).toBe(true);
	});

	it("fires onPartialHtml with a preview snapshot (title + first paragraphs) after a successful HTML crawl", async () => {
		const partials: Array<{ html: string; readyPageCount: number }> = [];
		const crawlAndFinalize = initCrawlAndFinalizeArticle({
			crawlArticle: async () => ({
				status: "fetched",
				html: "<html><head><title>The Title</title></head><body><p>First paragraph.</p><p>Second paragraph.</p></body></html>",
			}),
			finalizeArticle: okFinalize,
		});

		await crawlAndFinalize({
			url: URL_UNDER_TEST,
			onPartialHtml: (p) => { partials.push(p); },
		});

		expect(partials[0].html).toBe("<h1>The Title</h1><p>First paragraph.</p><p>Second paragraph.</p>");
		expect(partials[0].readyPageCount).toBe(1);
	});

	it("does not fire onPartialHtml with an empty preview snapshot (no title, no paragraphs)", async () => {
		const partials: Array<{ html: string; readyPageCount: number }> = [];
		const crawlAndFinalize = initCrawlAndFinalizeArticle({
			crawlArticle: async () => ({
				status: "fetched",
				html: "<html><body><div>no usable text</div></body></html>",
			}),
			finalizeArticle: okFinalize,
		});

		await crawlAndFinalize({
			url: URL_UNDER_TEST,
			onPartialHtml: (p) => { partials.push(p); },
		});

		expect(partials).toHaveLength(0);
	});

	it("works when onPartialHtml is omitted (callers that don't want streaming pay no cost)", async () => {
		const crawlAndFinalize = initCrawlAndFinalizeArticle({
			crawlArticle: async () => ({
				status: "fetched",
				html: "<html><head><title>T</title></head><body><p>body</p></body></html>",
			}),
			finalizeArticle: okFinalize,
		});

		const result = await crawlAndFinalize({ url: URL_UNDER_TEST });

		expect(result.status).toBe("fetched");
	});
});
