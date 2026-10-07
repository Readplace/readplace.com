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

	it("keeps the adopted-terminal pin for a crawl of the article's own URL, even when it retains the response body", async () => {
		const crawlArticle = jest.fn<Promise<CrawlArticleResult>, Parameters<CrawlArticle>>(async () => ({
			status: "fetched",
			html: "<html></html>",
			bodyHash: "a".repeat(64),
		}));
		const crawlAndFinalize = initCrawlAndFinalizeArticle({ crawlArticle, finalizeArticle: okFinalize });

		await crawlAndFinalize({ url: URL_UNDER_TEST, retainResponseBody: true });

		expect(crawlArticle).toHaveBeenCalledWith({
			url: URL_UNDER_TEST,
			etag: undefined,
			lastModified: undefined,
			previousBodyHash: undefined,
			fetchThumbnail: true,
			retainResponseBody: true,
		});
	});

	it("fetches a capture URL while finalizing under the article's own URL, resolving relative links against the capture", async () => {
		const capture = "https://web.archive.org/web/20081203185222/https://example.com/article";
		const crawlArticle = jest.fn<Promise<CrawlArticleResult>, Parameters<CrawlArticle>>(async () => ({
			status: "fetched",
			html: "<html></html>",
			bodyHash: "a".repeat(64),
		}));
		const finalizeArticle = jest.fn(okFinalize);
		const crawlAndFinalize = initCrawlAndFinalizeArticle({ crawlArticle, finalizeArticle });

		await crawlAndFinalize({ url: URL_UNDER_TEST, fetchUrl: capture });

		expect(crawlArticle).toHaveBeenCalledWith(expect.objectContaining({ url: capture, skipFetchPin: true }));
		expect(finalizeArticle).toHaveBeenCalledWith(expect.objectContaining({ url: URL_UNDER_TEST, documentUrl: capture }));
	});

	it("fails closed without fetching a capture URL that no longer passes validateSaveableUrl", async () => {
		const crawlArticle = jest.fn<Promise<CrawlArticleResult>, Parameters<CrawlArticle>>();
		const crawlAndFinalize = initCrawlAndFinalizeArticle({ crawlArticle, finalizeArticle: okFinalize });

		const result = await crawlAndFinalize({ url: URL_UNDER_TEST, fetchUrl: "http://169.254.169.254/latest/meta-data/" });

		expect(result).toEqual({ status: "failed", reason: "unsafe-url" });
		expect(crawlArticle).not.toHaveBeenCalled();
	});

	it("fails closed without fetching when the stored URL no longer passes validateSaveableUrl (SSRF defence-in-depth)", async () => {
		const crawlArticle = jest.fn<Promise<CrawlArticleResult>, Parameters<CrawlArticle>>();
		const finalizeArticle = jest.fn(okFinalize);
		const crawlAndFinalize = initCrawlAndFinalizeArticle({ crawlArticle, finalizeArticle });

		const result = await crawlAndFinalize({ url: "http://169.254.169.254/latest/meta-data/" });

		expect(result).toEqual({ status: "failed", reason: "unsafe-url" });
		expect(crawlArticle).not.toHaveBeenCalled();
		expect(finalizeArticle).not.toHaveBeenCalled();
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

	it("carries a structured content-too-large reason through the unsupported status", async () => {
		const crawlAndFinalize = initCrawlAndFinalizeArticle({
			crawlArticle: async () => ({
				status: "unsupported",
				reason: "content body too large: 54090542 bytes (cap 29360128 bytes)",
				unsupportedReason: { kind: "content-too-large", bytes: 54090542 },
			}),
			finalizeArticle: okFinalize,
		});

		const result = await crawlAndFinalize({ url: URL_UNDER_TEST });

		expect(result).toEqual({
			status: "unsupported",
			reason: "content body too large: 54090542 bytes (cap 29360128 bytes)",
			unsupportedReason: { kind: "content-too-large", bytes: 54090542 },
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

	it("carries the redirect destination through a failed crawl so a blocked destination can still be keyed", async () => {
		const crawlAndFinalize = initCrawlAndFinalizeArticle({
			crawlArticle: async () => ({ status: "failed", finalUrl: "https://dest.example/article" }),
			finalizeArticle: okFinalize,
		});

		const result = await crawlAndFinalize({ url: URL_UNDER_TEST });

		expect(result).toEqual({
			status: "failed",
			reason: "crawl-failed",
			finalUrl: "https://dest.example/article",
		});
	});

	it("threads the crawler's failure classification through so save-link-work can persist a precise reason", async () => {
		const crawlAndFinalize = initCrawlAndFinalizeArticle({
			crawlArticle: async () => ({
				status: "failed",
				finalUrl: "https://dest.example/article",
				failure: { kind: "origin-unreachable", httpStatus: 503 },
			}),
			finalizeArticle: okFinalize,
		});

		const result = await crawlAndFinalize({ url: URL_UNDER_TEST });

		expect(result).toEqual({
			status: "failed",
			reason: "crawl-failed",
			finalUrl: "https://dest.example/article",
			failure: { kind: "origin-unreachable", httpStatus: 503 },
		});
	});

	it("carries the redirect destination through an edge block, the case a click-tracker most often lands on", async () => {
		const crawlAndFinalize = initCrawlAndFinalizeArticle({
			crawlArticle: async () => ({ status: "blocked", httpStatus: 403, finalUrl: "https://dest.example/article" }),
			finalizeArticle: okFinalize,
		});

		const result = await crawlAndFinalize({ url: URL_UNDER_TEST });

		expect(result).toEqual({
			status: "blocked",
			httpStatus: 403,
			finalUrl: "https://dest.example/article",
		});
	});

	it("carries the redirect destination through a not-found so a dead link is keyed where it landed", async () => {
		const crawlAndFinalize = initCrawlAndFinalizeArticle({
			crawlArticle: async () => ({ status: "not-found", httpStatus: 410, finalUrl: "https://dest.example/gone" }),
			finalizeArticle: okFinalize,
		});

		const result = await crawlAndFinalize({ url: URL_UNDER_TEST });

		expect(result).toEqual({
			status: "not-found",
			httpStatus: 410,
			finalUrl: "https://dest.example/gone",
		});
	});

	it("carries the redirect destination through a finalizer parse failure, which reaches the destination but cannot read it", async () => {
		const crawlAndFinalize = initCrawlAndFinalizeArticle({
			crawlArticle: async () => ({
				status: "fetched",
				html: "<html></html>",
				bodyHash: "a".repeat(64),
				finalUrl: "https://dest.example/article",
			}),
			finalizeArticle: async () => ({ ok: false, reason: "readability crashed" }),
		});

		const result = await crawlAndFinalize({ url: URL_UNDER_TEST });

		expect(result).toEqual({
			status: "failed",
			reason: "readability crashed",
			finalUrl: "https://dest.example/article",
		});
	});

	it("maps the crawler's not-found status through with the httpStatus (callers terminalise without retries)", async () => {
		const crawlAndFinalize = initCrawlAndFinalizeArticle({
			crawlArticle: async () => ({ status: "not-found", httpStatus: 404 }),
			finalizeArticle: okFinalize,
		});

		const result = await crawlAndFinalize({ url: URL_UNDER_TEST });

		expect(result).toEqual({ status: "not-found", httpStatus: 404 });
	});

	it("maps the crawler's blocked status through with the httpStatus and never finalizes — there is no body to run Readability over", async () => {
		const finalizeArticle = jest.fn(okFinalize);
		const crawlAndFinalize = initCrawlAndFinalizeArticle({
			crawlArticle: async () => ({ status: "blocked", httpStatus: 403 }),
			finalizeArticle,
		});

		const result = await crawlAndFinalize({ url: URL_UNDER_TEST });

		expect(result).toEqual({ status: "blocked", httpStatus: 403 });
		expect(finalizeArticle).toHaveBeenCalledTimes(0);
	});

	it("threads the crawler's resolved thumbnail cascade into finalizeArticle so no second image fetch fires", async () => {
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
				thumbnail: { image: preFetched, provenUnusable: [] },
				bodyHash: "a".repeat(64),
			}),
			finalizeArticle,
		});

		await crawlAndFinalize({ url: URL_UNDER_TEST });

		expect(finalizeArticle).toHaveBeenCalledWith({
			url: URL_UNDER_TEST,
			documentUrl: URL_UNDER_TEST,
			html: "<html></html>",
			resolvedThumbnail: { image: preFetched, provenUnusable: [] },
			mediaType: undefined,
		});
	});

	it("threads the crawler's mediaType:image into finalizeArticle so the body is synthesised as an image", async () => {
		const imageBytes: ThumbnailImage = {
			body: Buffer.from([0xff, 0xd8, 0xff]),
			contentType: "image/jpeg",
			url: "https://example.com/photo.jpg",
			extension: ".jpg",
		};
		const finalizeArticle = jest.fn(okFinalize);
		const crawlAndFinalize = initCrawlAndFinalizeArticle({
			crawlArticle: async () => ({
				status: "fetched",
				mediaType: "image",
				html: '<figure><img src="https://example.com/photo.jpg" alt=""></figure>',
				thumbnail: { image: imageBytes, provenUnusable: [] },
				bodyHash: "a".repeat(64),
			}),
			finalizeArticle,
		});

		await crawlAndFinalize({ url: URL_UNDER_TEST });

		expect(finalizeArticle).toHaveBeenCalledWith({
			url: URL_UNDER_TEST,
			documentUrl: URL_UNDER_TEST,
			html: '<figure><img src="https://example.com/photo.jpg" alt=""></figure>',
			resolvedThumbnail: { image: imageBytes, provenUnusable: [] },
			mediaType: "image",
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

	it("returns the finalized article + redirect terminal + freshness headers and bodyHash on success so callers persist them", async () => {
		const crawlAndFinalize = initCrawlAndFinalizeArticle({
			crawlArticle: async () => ({
				status: "fetched",
				html: "<html></html>",
				finalUrl: "https://example.com/final",
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
			finalUrl: "https://example.com/final",
			etag: '"v1"',
			lastModified: "Wed, 01 Apr 2026 00:00:00 GMT",
			bodyHash: "deadbeef".repeat(8),
		});
	});
});

describe("wrapper evaluation evidence", () => {
	it.each([true, false])("preserves the raw evaluation supplied beside converted plain-text HTML when finalized=%s", async (ok) => {
		const finalizeArticle: FinalizeArticle = ok ? okFinalize : async () => ({ ok: false, reason: "empty document" });
		const crawlAndFinalize = initCrawlAndFinalizeArticle({ crawlArticle: async () => ({ status: "fetched", html: "<html><body><p>Converted text</p></body></html>", evaluationHtml: "Original plain-text response", bodyHash: "raw-hash", httpStatus: 200 }), finalizeArticle });
		expect(await crawlAndFinalize({ url: URL_UNDER_TEST, retainResponseBody: true })).toMatchObject({ status: "fetched", evaluationHtml: "Original plain-text response", httpStatus: 200 });
	});
	it("keeps fetched raw HTML and HTTP status when extraction succeeds", async () => {
		const crawlAndFinalize = initCrawlAndFinalizeArticle({ crawlArticle: async () => ({ status: "fetched", html: "<html>raw</html>", bodyHash: "hash", httpStatus: 403 }), finalizeArticle: okFinalize });
		expect(await crawlAndFinalize({ url: URL_UNDER_TEST, retainResponseBody: true })).toEqual(expect.objectContaining({ status: "fetched", article: stubFinalizedArticle, evaluationHtml: "<html>raw</html>", httpStatus: 403 }));
	});
	it("preserves a failed extraction as an empty reader candidate with the original evaluation bytes", async () => {
		const captcha = "<html><body><form id=\"captcha\">Please complete the security check</form></body></html>";
		const crawlAndFinalize = initCrawlAndFinalizeArticle({ crawlArticle: async () => ({ status: "fetched", html: captcha, bodyHash: "captcha-hash", httpStatus: 429 }), finalizeArticle: async () => ({ ok: false, reason: "no readable content" }) });
		expect(await crawlAndFinalize({ url: URL_UNDER_TEST, retainResponseBody: true })).toEqual({ status: "fetched", article: { html: "", metadata: { title: "", siteName: "", excerpt: "", wordCount: 0, estimatedReadTime: 0 } }, evaluationHtml: captcha, bodyHash: "captcha-hash", finalUrl: undefined, httpStatus: 429, parseFailure: "no readable content" });
	});
	it.each(["", " \n\t "])("fails a retained response whose body is empty (%j) instead of keeping it as a candidate", async (html) => {
		const crawlAndFinalize = initCrawlAndFinalizeArticle({ crawlArticle: async () => ({ status: "fetched", html, bodyHash: "empty-hash", httpStatus: 503, finalUrl: "https://archive.ph/abc" }), finalizeArticle: async () => ({ ok: false, reason: "no <html> element in response body" }) });
		expect(await crawlAndFinalize({ url: URL_UNDER_TEST, retainResponseBody: true })).toEqual({ status: "failed", reason: "no <html> element in response body", finalUrl: "https://archive.ph/abc" });
	});
});


it("preserves raw evaluation for conditional refreshes without changing conditional fetch or error handling", async () => {
	const raw = "<html><body>Raw response before reader finalization</body></html>";
	const crawlArticle = jest.fn<Promise<CrawlArticleResult>, Parameters<CrawlArticle>>().mockResolvedValue({ status: "fetched", html: raw, bodyHash: "a".repeat(64) });
	const crawlAndFinalize = initCrawlAndFinalizeArticle({ crawlArticle, finalizeArticle: okFinalize });
	await expect(crawlAndFinalize({ url: URL_UNDER_TEST, includeEvaluationHtml: true, etag: "etag", previousBodyHash: "b".repeat(64) })).resolves.toMatchObject({ status: "fetched", article: stubFinalizedArticle, evaluationHtml: raw });
	expect(crawlArticle).toHaveBeenCalledWith({ url: URL_UNDER_TEST, etag: "etag", lastModified: undefined, previousBodyHash: "b".repeat(64), fetchThumbnail: true });
});
