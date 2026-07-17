import assert from "node:assert";
import { createHash } from "node:crypto";
import {
	DEFAULT_CRAWL_HEADERS,
	initCrawlArticle,
	parseHtmlFromBuffer,
	parsePdfFromBuffer,
} from "./crawl-article";
import type { CrawlArticleResult } from "./crawl-article.types";
import type { CrawlFetch } from "./crawl-fetch";
import { initCrawlFetch } from "./crawl-fetch";
import type { CurlFetch } from "./curl-fetch";
import { redirectable } from "./follow-redirects";
import type { fetchH2 } from "./h2-fetch";
import type { ExtractPdf } from "./pdf-extract.types";
import { initXTwitterSiteRules } from "./x-twitter-site-rules";
import { noExtract, noTransform, skipCrawl } from "@packages/site-rules";
import type { SiteRules } from "@packages/site-rules";

const PDF_BYTES_CAP = 25 * 1024 * 1024;

const PDF_EXTRACT_FAILURE_REASON = "synthetic extractor failure";
const PDF_MAGIC_BUFFER = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(64, 0x20)]);

const noopLogError = () => {};
const noopLogInfo = () => {};

// Never reached in unit tests: curl/h2 fallback only fires on block-class
// responses/errors, which these fixtures don't produce. The fallback chain has
// its own coverage in crawl-fetch/curl-fetch/h2-fetch tests.
const stubFetchCurl: CurlFetch = async () => {
	throw new Error("stub fetchCurl: not invoked");
};
const stubFetchH2: typeof fetchH2 = async () => {
	throw new Error("stub fetchH2: not invoked");
};

/** Wrap a fake origin `fetch` in the real crawl-fetch stack so tests exercise
 * the same header-merge + fallback wiring production uses. */
function buildCrawlFetch(overrides: {
	fetch: typeof fetch;
	fetchCurl?: CurlFetch;
	fetchH2?: typeof fetchH2;
	rateLimitRetryDelaysMs?: readonly number[];
}): CrawlFetch {
	return initCrawlFetch({
		fetch: overrides.fetch,
		personas: [{ name: "test-default", headers: { ...DEFAULT_CRAWL_HEADERS } }],
		isBlocked: () => false,
		fetchCurl: overrides.fetchCurl ?? stubFetchCurl,
		fetchH2: overrides.fetchH2 ?? stubFetchH2,
		rateLimitRetryDelaysMs: overrides.rateLimitRetryDelaysMs,
	});
}

function initCrawl(overrides: {
	fetch: typeof fetch;
	extractPdf?: ExtractPdf;
	logError?: (message: string, error?: Error) => void;
	logInfo?: (message: string) => void;
	fetchCurl?: CurlFetch;
	fetchH2?: typeof fetchH2;
	siteRules?: readonly SiteRules[];
	fetchTimeouts?: { headersMs: number; bodyMs: number };
	rateLimitRetryDelaysMs?: readonly number[];
}) {
	const crawlFetch = buildCrawlFetch(overrides);
	const logError = overrides.logError ?? noopLogError;
	return initCrawlArticle({
		crawlFetch,
		siteRules: overrides.siteRules ?? [initXTwitterSiteRules({ crawlFetch, logError })],
		extractPdf: overrides.extractPdf,
		logError,
		logInfo: overrides.logInfo ?? noopLogInfo,
		fetchTimeouts: overrides.fetchTimeouts,
	});
}

function plainHeaders(init: RequestInit | undefined): Record<string, string> {
	assert(init !== undefined, "Expected fetch init to be captured");
	const headers = init.headers;
	assert(headers !== undefined, "Expected init.headers to be set");
	assert(!(headers instanceof Headers), "Expected plain object headers, not Headers instance");
	assert(!Array.isArray(headers), "Expected plain object headers, not array");
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		assert(typeof value === "string", `Expected string header value for "${key}"`);
		result[key] = value;
	}
	return result;
}

function assertFetched(result: CrawlArticleResult): asserts result is CrawlArticleResult & { status: "fetched" } {
	assert(result.status === "fetched", `Expected 'fetched', got '${result.status}'`);
}

describe("initCrawlArticle — single-fetch orchestration", () => {
	it("routes X/Twitter URLs through oembed without fetching the article URL", async () => {
		const requested: string[] = [];
		const fakeFetch: typeof fetch = async (input) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			requested.push(url);
			return new Response(JSON.stringify({ author_name: "User", html: "<blockquote>x</blockquote>" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		};
		const crawlArticle = initCrawl({ fetch: fakeFetch });

		const result = await crawlArticle({ url: "https://x.com/user/status/123" });

		assertFetched(result);
		expect(requested).toEqual(["https://publish.twitter.com/oembed?url=https%3A%2F%2Fx.com%2Fuser%2Fstatus%2F123"]);
	});

	it("falls through to the normal fetch when a matching site declines the crawl (skip)", async () => {
		const fetched: string[] = [];
		const fakeFetch: typeof fetch = async (input) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			fetched.push(url);
			return new Response(
				"<html><body><article><p>Real body fetched after the site declined the crawl override with enough words for readability.</p></article></body></html>",
				{ status: 200, headers: { "content-type": "text/html" } },
			);
		};
		const decliningSite: SiteRules = { matches: () => true, onCrawl: skipCrawl, extract: noExtract, transform: noTransform };
		const crawlArticle = initCrawl({ fetch: fakeFetch, siteRules: [decliningSite] });

		const result = await crawlArticle({ url: "https://example.com/post" });

		assertFetched(result);
		expect(fetched).toEqual(["https://example.com/post"]);
	});

	it("fails closed when a matching site's crawl override fails, without fetching the URL", async () => {
		const fetched: string[] = [];
		const fakeFetch: typeof fetch = async (input) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			fetched.push(url);
			return new Response("body", { status: 200, headers: { "content-type": "text/html" } });
		};
		const failingSite: SiteRules = {
			matches: () => true,
			onCrawl: async () => ({ kind: "failed" }),
			extract: noExtract,
			transform: noTransform,
		};
		const crawlArticle = initCrawl({ fetch: fakeFetch, siteRules: [failingSite] });

		const result = await crawlArticle({ url: "https://example.com/post" });

		expect(result).toEqual({ status: "failed" });
		expect(fetched).toEqual([]);
	});

	it("fails closed without escaping or fetching when a matching site's onCrawl throws", async () => {
		const onCrawlError = new Error("onCrawl boom");
		const fetched: string[] = [];
		const fakeFetch: typeof fetch = async (input) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			fetched.push(url);
			return new Response("body", { status: 200, headers: { "content-type": "text/html" } });
		};
		const throwingSite: SiteRules = {
			matches: () => true,
			onCrawl: async () => {
				throw onCrawlError;
			},
			extract: noExtract,
			transform: noTransform,
		};
		const logError = jest.fn();
		const crawlArticle = initCrawl({ fetch: fakeFetch, siteRules: [throwingSite], logError });

		const result = await crawlArticle({ url: "https://example.com/post" });

		expect(result).toEqual({ status: "failed" });
		expect(fetched).toEqual([]);
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] Site onCrawl threw for https://example.com/post", onCrawlError);
	});

	it("fails closed and logs undefined when a matching site's onCrawl throws a non-Error value", async () => {
		const fakeFetch: typeof fetch = async () => {
			throw new Error("fetch must not be invoked when a site has claimed the URL");
		};
		const throwingSite: SiteRules = {
			matches: () => true,
			onCrawl: async () => {
				throw "boom";
			},
			extract: noExtract,
			transform: noTransform,
		};
		const logError = jest.fn();
		const crawlArticle = initCrawl({ fetch: fakeFetch, siteRules: [throwingSite], logError });

		const result = await crawlArticle({ url: "https://example.com/post" });

		expect(result).toEqual({ status: "failed" });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] Site onCrawl threw for https://example.com/post", undefined);
	});

	it("skips a site and falls through to the normal fetch when its matches throws, without escaping", async () => {
		const matchesError = new Error("matches boom");
		const fetched: string[] = [];
		const fakeFetch: typeof fetch = async (input) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			fetched.push(url);
			return new Response(
				"<html><body><article><p>Real body fetched after the throwing matches was skipped, with enough words for readability.</p></article></body></html>",
				{ status: 200, headers: { "content-type": "text/html" } },
			);
		};
		const throwingMatchSite: SiteRules = {
			matches: () => {
				throw matchesError;
			},
			onCrawl: skipCrawl,
			extract: noExtract,
			transform: noTransform,
		};
		const logError = jest.fn();
		const crawlArticle = initCrawl({ fetch: fakeFetch, siteRules: [throwingMatchSite], logError });

		const result = await crawlArticle({ url: "https://example.com/post" });

		assertFetched(result);
		expect(fetched).toEqual(["https://example.com/post"]);
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] Site matches threw for https://example.com/post", matchesError);
	});

	it("skips a site and logs undefined when its matches throws a non-Error value", async () => {
		const fakeFetch: typeof fetch = async () =>
			new Response(
				"<html><body><article><p>Real body fetched after the non-Error matches throw was skipped, with enough words for readability.</p></article></body></html>",
				{ status: 200, headers: { "content-type": "text/html" } },
			);
		const throwingMatchSite: SiteRules = {
			matches: () => {
				throw "boom";
			},
			onCrawl: skipCrawl,
			extract: noExtract,
			transform: noTransform,
		};
		const logError = jest.fn();
		const crawlArticle = initCrawl({ fetch: fakeFetch, siteRules: [throwingMatchSite], logError });

		const result = await crawlArticle({ url: "https://example.com/post" });

		assertFetched(result);
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] Site matches threw for https://example.com/post", undefined);
	});

	it("fails closed without throwing or fetching when given a malformed URL", async () => {
		const fakeFetch: typeof fetch = async () => {
			throw new Error("fetch must not be invoked for a malformed URL");
		};
		const logError = jest.fn();
		const crawlArticle = initCrawl({ fetch: fakeFetch, logError });

		const result = await crawlArticle({ url: "not a valid url" });

		expect(result).toEqual({ status: "failed" });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] Invalid URL not a valid url");
	});

	it("returns not-modified on 304 and forwards If-None-Match / If-Modified-Since", async () => {
		let capturedInit: RequestInit | undefined;
		const fakeFetch: typeof fetch = async (_input, init) => {
			capturedInit = init;
			return new Response(null, { status: 304 });
		};
		const crawlArticle = initCrawl({ fetch: fakeFetch });

		const result = await crawlArticle({
			url: "https://example.com",
			etag: '"abc123"',
			lastModified: "Wed, 21 Oct 2025 07:28:00 GMT",
		});

		expect(result).toEqual({ status: "not-modified" });
		const headers = plainHeaders(capturedInit);
		expect(headers["if-none-match"]).toBe('"abc123"');
		expect(headers["if-modified-since"]).toBe("Wed, 21 Oct 2025 07:28:00 GMT");
	});

	it("makes exactly one request and returns fetched html + captured validators on an HTML 200", async () => {
		let calls = 0;
		const fakeFetch: typeof fetch = async () => {
			calls += 1;
			return new Response("<html>Hello</html>", {
				status: 200,
				headers: {
					"content-type": "text/html",
					etag: '"abc123"',
					"last-modified": "Wed, 21 Oct 2025 07:28:00 GMT",
				},
			});
		};
		const extractPdf = jest.fn<ReturnType<ExtractPdf>, Parameters<ExtractPdf>>();
		const crawlArticle = initCrawl({ fetch: fakeFetch, extractPdf });

		const result = await crawlArticle({ url: "https://example.com" });

		expect(result).toEqual({
			status: "fetched",
			html: "<html>Hello</html>",
			etag: '"abc123"',
			lastModified: "Wed, 21 Oct 2025 07:28:00 GMT",
			bodyHash: createHash("sha256").update(Buffer.from("<html>Hello</html>")).digest("hex"),
		});
		expect(calls).toBe(1);
		expect(extractPdf).not.toHaveBeenCalled();
	});

	it("treats application/xhtml+xml as HTML", async () => {
		const fakeFetch: typeof fetch = async () =>
			new Response("<html>XHTML content</html>", {
				status: 200,
				headers: { "content-type": "application/xhtml+xml; charset=utf-8" },
			});
		const crawlArticle = initCrawl({ fetch: fakeFetch });

		const result = await crawlArticle({ url: "https://example.com" });

		assertFetched(result);
		expect(result.html).toBe("<html>XHTML content</html>");
	});

	it("makes one request and extracts the PDF when given application/pdf and an extractPdf dep", async () => {
		let capturedExtract: { buffer: Buffer; url: string } | undefined;
		let calls = 0;
		const extractPdf: ExtractPdf = async (params) => {
			capturedExtract = params;
			return { kind: "fetched", html: "<html><body><h1>Title</h1><p>Body</p></body></html>", title: "Title" };
		};
		const fakeFetch: typeof fetch = async () => {
			calls += 1;
			return new Response(PDF_MAGIC_BUFFER, {
				status: 200,
				headers: {
					"content-type": "application/pdf",
					etag: '"pdf-123"',
					"last-modified": "Wed, 21 Oct 2025 07:28:00 GMT",
				},
			});
		};
		const crawlArticle = initCrawl({ fetch: fakeFetch, extractPdf });

		const result = await crawlArticle({ url: "https://example.com/doc.pdf" });

		expect(result).toEqual({
			status: "fetched",
			html: "<html><body><h1>Title</h1><p>Body</p></body></html>",
			etag: '"pdf-123"',
			lastModified: "Wed, 21 Oct 2025 07:28:00 GMT",
			bodyHash: createHash("sha256").update(PDF_MAGIC_BUFFER).digest("hex"),
		});
		expect(calls).toBe(1);
		expect(capturedExtract?.url).toBe("https://example.com/doc.pdf");
		expect(capturedExtract?.buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
	});

	it("dispatches to the PDF path via magic-byte sniffing when the content-type is octet-stream", async () => {
		const extractPdf = jest.fn<ReturnType<ExtractPdf>, Parameters<ExtractPdf>>().mockResolvedValue({
			kind: "fetched",
			html: "<html><body><p>sniffed</p></body></html>",
			title: "sniffed",
		});
		const fakeFetch: typeof fetch = async () =>
			new Response(PDF_MAGIC_BUFFER, { status: 200, headers: { "content-type": "application/octet-stream" } });
		const crawlArticle = initCrawl({ fetch: fakeFetch, extractPdf });

		const result = await crawlArticle({ url: "https://example.com/noheader" });

		expect(result.status).toBe("fetched");
		expect(extractPdf).toHaveBeenCalledTimes(1);
	});

	it("returns unsupported for a PDF body when constructed without an extractPdf dep (simple-only path) and logs the deferral at info", async () => {
		const fakeFetch: typeof fetch = async () =>
			new Response(PDF_MAGIC_BUFFER, { status: 200, headers: { "content-type": "application/pdf" } });
		const logError = jest.fn();
		const logInfo = jest.fn();
		const crawlArticle = initCrawl({ fetch: fakeFetch, logError, logInfo });

		const result = await crawlArticle({ url: "https://example.com/doc.pdf" });

		expect(result).toEqual({ status: "unsupported", reason: "unsupported content type: application/pdf" });
		expect(logInfo).toHaveBeenCalledWith("[CrawlArticle] PDF deferred to comprehensive crawl (no extractPdf in this runtime) for https://example.com/doc.pdf");
		expect(logError).not.toHaveBeenCalled();
	});

	it("returns unsupported and never invokes the extractor for a non-HTML non-PDF content type", async () => {
		const extractPdf = jest.fn<ReturnType<ExtractPdf>, Parameters<ExtractPdf>>();
		const fakeFetch: typeof fetch = async () =>
			new Response(Buffer.from([0, 1, 2, 3]), { status: 200, headers: { "content-type": "video/mp4" } });
		const logError = jest.fn();
		const crawlArticle = initCrawl({ fetch: fakeFetch, extractPdf, logError });

		const result = await crawlArticle({ url: "https://example.com/clip.mp4" });

		expect(result).toEqual({ status: "unsupported", reason: "unsupported content type: video/mp4" });
		expect(extractPdf).not.toHaveBeenCalled();
		expect(logError).toHaveBeenCalledWith('[CrawlArticle] Unsupported content-type "video/mp4" for https://example.com/clip.mp4');
	});

	it("dispatches text/plain to the plain-text path, wrapping the body as article HTML without the extractor", async () => {
		const fakeFetch: typeof fetch = async () =>
			new Response("Line one.\n\nLine two.", {
				status: 200,
				headers: { "content-type": "text/plain; charset=utf-8", etag: '"txt-1"' },
			});
		const extractPdf = jest.fn<ReturnType<ExtractPdf>, Parameters<ExtractPdf>>();
		const crawlArticle = initCrawl({ fetch: fakeFetch, extractPdf });

		const result = await crawlArticle({ url: "https://example.com/notes/readme.txt" });

		assertFetched(result);
		expect(result.html).toBe(
			"<!DOCTYPE html><html><head><title>readme</title></head><body><article><h1>readme</h1><p>Line one.</p><p>Line two.</p></article></body></html>",
		);
		expect(result.etag).toBe('"txt-1"');
		expect(extractPdf).not.toHaveBeenCalled();
	});

	it("dispatches an image content-type to the image path, carrying the bytes and tagging mediaType:image", async () => {
		const imageBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
		const extractPdf = jest.fn<ReturnType<ExtractPdf>, Parameters<ExtractPdf>>();
		const fakeFetch: typeof fetch = async () =>
			new Response(imageBytes, {
				status: 200,
				headers: { "content-type": "image/jpeg", etag: '"img-1"' },
			});
		const crawlArticle = initCrawl({ fetch: fakeFetch, extractPdf });

		const result = await crawlArticle({ url: "https://example.com/photo.jpg" });

		assertFetched(result);
		expect(result.mediaType).toBe("image");
		expect(result.thumbnailImage).toEqual({
			body: imageBytes,
			contentType: "image/jpeg",
			url: "https://example.com/photo.jpg",
			extension: ".jpg",
		});
		expect(result.html).toBe('<figure><img src="https://example.com/photo.jpg" alt=""></figure>');
		expect(result.etag).toBe('"img-1"');
		expect(extractPdf).not.toHaveBeenCalled();
	});

	it("returns failed and logs the HTTP status on a non-ok, non-304 response", async () => {
		const fakeFetch: typeof fetch = async () => new Response(null, { status: 500 });
		const logError = jest.fn();
		const crawlArticle = initCrawl({ fetch: fakeFetch, logError });

		const result = await crawlArticle({ url: "https://example.com" });

		expect(result).toEqual({ status: "failed" });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] HTTP 500 for https://example.com");
	});

	it("logs edge-diagnostic headers when the failing response carries them", async () => {
		const fakeFetch: typeof fetch = async () =>
			new Response(null, {
				status: 503,
				headers: {
					server: "cloudflare",
					"cf-mitigated": "challenge",
					"cf-ray": "9560a1b2c3d4e5f6-SYD",
				},
			});
		const logError = jest.fn();
		const crawlArticle = initCrawl({ fetch: fakeFetch, logError });

		const result = await crawlArticle({ url: "https://example.com" });

		expect(result).toEqual({ status: "failed" });
		expect(logError).toHaveBeenCalledWith(
			"[CrawlArticle] HTTP 503 for https://example.com (server=cloudflare, cf-mitigated=challenge, cf-ray=9560a1b2c3d4e5f6-SYD)",
		);
	});

	it("returns not-found on an HTTP 404 and logs at info because the miss is non-recoverable", async () => {
		const fakeFetch: typeof fetch = async () => new Response(null, { status: 404 });
		const logError = jest.fn();
		const logInfo = jest.fn();
		const crawlArticle = initCrawl({ fetch: fakeFetch, logError, logInfo });

		const result = await crawlArticle({ url: "https://example.com/deleted" });

		expect(result).toEqual({ status: "not-found", httpStatus: 404 });
		expect(logInfo).toHaveBeenCalledWith("[CrawlArticle] HTTP 404 for https://example.com/deleted");
		expect(logError).not.toHaveBeenCalled();
	});

	it("returns failed on an HTTP 406 and logs at info because content-negotiation refusals are non-recoverable", async () => {
		const fakeFetch: typeof fetch = async () => new Response(null, { status: 406 });
		const logError = jest.fn();
		const logInfo = jest.fn();
		const crawlArticle = initCrawl({ fetch: fakeFetch, logError, logInfo });

		const result = await crawlArticle({ url: "https://example.com" });

		expect(result).toEqual({ status: "failed" });
		expect(logInfo).toHaveBeenCalledWith("[CrawlArticle] HTTP 406 for https://example.com");
		expect(logError).not.toHaveBeenCalled();
	});

	it("returns failed and logs at info when every TLS-fingerprint fallback stays blocked with 403", async () => {
		const blocked = async () => new Response(null, { status: 403 });
		const logError = jest.fn();
		const logInfo = jest.fn();
		const crawlArticle = initCrawl({
			fetch: blocked,
			fetchH2: blocked,
			fetchCurl: blocked,
			logError,
			logInfo,
		});

		const result = await crawlArticle({ url: "https://example.com" });

		expect(result).toEqual({ status: "failed" });
		expect(logInfo).toHaveBeenCalledWith("[CrawlArticle] HTTP 403 for https://example.com");
		expect(logError).not.toHaveBeenCalled();
	});

	it("returns failed and logs at info when the origin keeps rate-limiting with 429", async () => {
		const rateLimited = async () => new Response(null, { status: 429 });
		const logError = jest.fn();
		const logInfo = jest.fn();
		const crawlArticle = initCrawl({
			fetch: rateLimited,
			fetchH2: rateLimited,
			fetchCurl: rateLimited,
			rateLimitRetryDelaysMs: [],
			logError,
			logInfo,
		});

		const result = await crawlArticle({ url: "https://example.com" });

		expect(result).toEqual({ status: "failed" });
		expect(logInfo).toHaveBeenCalledWith("[CrawlArticle] HTTP 429 for https://example.com");
		expect(logError).not.toHaveBeenCalled();
	});

	it("returns not-found with the status on an HTTP 410 Gone", async () => {
		const fakeFetch: typeof fetch = async () => new Response(null, { status: 410 });
		const logError = jest.fn();
		const crawlArticle = initCrawl({ fetch: fakeFetch, logError });

		const result = await crawlArticle({ url: "https://example.com/delisted" });

		expect(result).toEqual({ status: "not-found", httpStatus: 410 });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] HTTP 410 for https://example.com/delisted");
	});

	it("returns failed and logs the Error when the fetch throws a network error", async () => {
		const networkError = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
		const fakeFetch: typeof fetch = async () => { throw networkError; };
		const logError = jest.fn();
		const crawlArticle = initCrawl({ fetch: fakeFetch, logError });

		const result = await crawlArticle({ url: "https://example.com" });

		expect(result).toEqual({ status: "failed" });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] Network error for https://example.com", networkError);
	});

	it("returns not-modified without invoking the extractor when previousBodyHash matches the materialised bytes (PDF path)", async () => {
		const expectedHash = createHash("sha256").update(PDF_MAGIC_BUFFER).digest("hex");
		const extractPdf = jest.fn<ReturnType<ExtractPdf>, Parameters<ExtractPdf>>();
		const fakeFetch: typeof fetch = async () =>
			new Response(PDF_MAGIC_BUFFER, { status: 200, headers: { "content-type": "application/pdf" } });
		const crawlArticle = initCrawl({ fetch: fakeFetch, extractPdf });

		const result = await crawlArticle({
			url: "https://example.com/doc.pdf",
			previousBodyHash: expectedHash,
		});

		expect(result).toEqual({ status: "not-modified" });
		expect(extractPdf).not.toHaveBeenCalled();
	});

	it("returns not-modified without decoding HTML when previousBodyHash matches the materialised bytes (HTML path)", async () => {
		const html = "<html>Hello</html>";
		const expectedHash = createHash("sha256").update(Buffer.from(html)).digest("hex");
		const fakeFetch: typeof fetch = async () =>
			new Response(html, { status: 200, headers: { "content-type": "text/html" } });
		const crawlArticle = initCrawl({ fetch: fakeFetch });

		const result = await crawlArticle({
			url: "https://example.com",
			previousBodyHash: expectedHash,
		});

		expect(result).toEqual({ status: "not-modified" });
	});

	it("falls through to the parser when previousBodyHash differs from the materialised bytes (gate miss)", async () => {
		const fakeFetch: typeof fetch = async () =>
			new Response("<html>changed</html>", {
				status: 200,
				headers: { "content-type": "text/html" },
			});
		const crawlArticle = initCrawl({ fetch: fakeFetch });

		const result = await crawlArticle({
			url: "https://example.com",
			previousBodyHash: "0".repeat(64),
		});

		assertFetched(result);
		expect(result.html).toBe("<html>changed</html>");
		expect(result.bodyHash).toBe(
			createHash("sha256").update(Buffer.from("<html>changed</html>")).digest("hex"),
		);
	});

	it("populates bodyHash on the fetched result even when previousBodyHash was not supplied (first-ever fetch)", async () => {
		const fakeFetch: typeof fetch = async () =>
			new Response("<html>x</html>", {
				status: 200,
				headers: { "content-type": "text/html" },
			});
		const crawlArticle = initCrawl({ fetch: fakeFetch });

		const result = await crawlArticle({ url: "https://example.com" });

		assertFetched(result);
		expect(result.bodyHash).toBe(
			createHash("sha256").update(Buffer.from("<html>x</html>")).digest("hex"),
		);
	});

	it("forwards fetchThumbnail through to the HTML parser so the thumbnail prefetches in the same crawl", async () => {
		const articleHtml = `<html><head><meta property="og:image" content="https://cdn.example.com/thumb.jpg"></head></html>`;
		const imageBytes = Buffer.from([0xff, 0xd8, 0xff]);
		let call = 0;
		const fakeFetch: typeof fetch = async (input) => {
			call += 1;
			if (call === 1) return new Response(articleHtml, { status: 200, headers: { "content-type": "text/html" } });
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			expect(url).toBe("https://cdn.example.com/thumb.jpg");
			return new Response(imageBytes, { status: 200, headers: { "content-type": "image/jpeg" } });
		};
		const crawlArticle = initCrawl({ fetch: fakeFetch });

		const result = await crawlArticle({ url: "https://example.com/article", fetchThumbnail: true });

		assertFetched(result);
		expect(result.thumbnailImage).toEqual({
			body: imageBytes,
			contentType: "image/jpeg",
			url: "https://cdn.example.com/thumb.jpg",
			extension: ".jpg",
		});
	});

	it("stamps finalUrl from the primary response.url onto the fetched result", async () => {
		const fakeFetch: typeof fetch = async () => {
			const response = new Response("<html><body>hi</body></html>", {
				status: 200,
				headers: { "content-type": "text/html" },
			});
			Object.defineProperty(response, "url", { value: "https://example.com/final" });
			return response;
		};
		const crawlArticle = initCrawl({ fetch: fakeFetch });

		const result = await crawlArticle({ url: "https://example.com/requested" });

		assertFetched(result);
		expect(result.finalUrl).toBe("https://example.com/final");
	});

	it("stamps finalUrl from a redirectable fallback response, whose .url carries the followed terminal", async () => {
		// A fallback transport (curl/h2/aia) is `redirectable(singleHop)`: it
		// follows redirects and stamps the terminal onto the synthetic Response's
		// `.url`, so the orchestrator reads it the same way it reads undici's.
		const hops = [
			new Response(null, { status: 301, headers: { location: "https://example.com/final" } }),
			new Response("<html><body>hi</body></html>", { status: 200, headers: { "content-type": "text/html" } }),
		];
		let hop = 0;
		const fallbackResponse = await redirectable(async () => hops[hop++], "test")("https://example.com/start");
		expect(fallbackResponse.url).toBe("https://example.com/final");
		const crawlArticle = initCrawl({ fetch: async () => fallbackResponse });

		const result = await crawlArticle({ url: "https://example.com/start" });

		assertFetched(result);
		expect(result.finalUrl).toBe("https://example.com/final");
	});

	it("leaves finalUrl unset for the site-rule/oembed path, which issues no article fetch", async () => {
		const fakeFetch: typeof fetch = async () =>
			new Response(JSON.stringify({ author_name: "User", html: "<blockquote>x</blockquote>" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		const crawlArticle = initCrawl({ fetch: fakeFetch });

		const result = await crawlArticle({ url: "https://x.com/user/status/123" });

		assertFetched(result);
		expect(result.finalUrl).toBeUndefined();
	});
});

describe("initCrawlArticle — site-rule redirect restarts the crawl", () => {
	function redirectSite(params: { hostname: string; redirectTo: string }): SiteRules {
		return {
			matches: ({ hostname }) => hostname === params.hostname,
			onCrawl: async () => ({ kind: "redirect", url: params.redirectTo }),
			extract: noExtract,
			transform: noTransform,
		};
	}

	function urlStampingFetch(collector: string[]): typeof fetch {
		return async (input) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			collector.push(url);
			const response = new Response(
				"<html><body><article><p>Publisher article body served at the redirect target.</p></article></body></html>",
				{ status: 200, headers: { "content-type": "text/html" } },
			);
			// Mimic undici, which populates the read-only `.url` on real fetches.
			Object.defineProperty(response, "url", { value: url });
			return response;
		};
	}

	it("fetches the redirect target instead of the claimed URL and stamps it as finalUrl", async () => {
		const fetched: string[] = [];
		const crawlArticle = initCrawl({
			fetch: urlStampingFetch(fetched),
			siteRules: [redirectSite({ hostname: "shell.example", redirectTo: "https://story.example/article" })],
		});

		const result = await crawlArticle({ url: "https://shell.example/A123" });

		assertFetched(result);
		expect(fetched).toEqual(["https://story.example/article"]);
		expect(result.finalUrl).toBe("https://story.example/article");
	});

	it("re-runs site rules for the redirect target so it gets its own bespoke treatment", async () => {
		const fetched: string[] = [];
		const targetContentSite: SiteRules = {
			matches: ({ hostname }) => hostname === "story.example",
			onCrawl: async () => ({ kind: "content", html: "<html><body>bespoke</body></html>" }),
			extract: noExtract,
			transform: noTransform,
		};
		const crawlArticle = initCrawl({
			fetch: urlStampingFetch(fetched),
			siteRules: [
				redirectSite({ hostname: "shell.example", redirectTo: "https://story.example/article" }),
				targetContentSite,
			],
		});

		const result = await crawlArticle({ url: "https://shell.example/A123" });

		assertFetched(result);
		expect(result.html).toBe("<html><body>bespoke</body></html>");
		expect(fetched).toEqual([]);
	});

	it("fails closed when site-rule redirects exceed the hop cap", async () => {
		const logError = jest.fn();
		const selfRedirectingSite: SiteRules = {
			matches: ({ hostname }) => hostname === "loop.example",
			onCrawl: async () => ({ kind: "redirect", url: "https://loop.example/again" }),
			extract: noExtract,
			transform: noTransform,
		};
		const fetched: string[] = [];
		const crawlArticle = initCrawl({
			fetch: urlStampingFetch(fetched),
			siteRules: [selfRedirectingSite],
			logError,
		});

		const result = await crawlArticle({ url: "https://loop.example/entry" });

		expect(result).toEqual({ status: "failed" });
		expect(fetched).toEqual([]);
		expect(logError).toHaveBeenCalledWith(
			"[CrawlArticle] Too many site-rule redirects (>3) for https://loop.example/entry",
		);
	});

	it("fails when a site-rule redirect target is not a parseable URL", async () => {
		const logError = jest.fn();
		const fetched: string[] = [];
		const crawlArticle = initCrawl({
			fetch: urlStampingFetch(fetched),
			siteRules: [redirectSite({ hostname: "shell.example", redirectTo: "::::" })],
			logError,
		});

		const result = await crawlArticle({ url: "https://shell.example/A123" });

		expect(result).toEqual({ status: "failed" });
		expect(fetched).toEqual([]);
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] Invalid URL ::::");
	});
});

describe("initCrawlArticle — split fetch budgets (headers vs body)", () => {
	const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

	function requireSignal(init: RequestInit | undefined): AbortSignal {
		const signal = init?.signal;
		assert(signal, "Expected the crawl fetch to pass an AbortSignal");
		return signal;
	}

	it("aborts with a TimeoutError when no headers arrive within the headers budget, then falls back to signal-less curl", async () => {
		const curlError = new Error("curl fallback also failed");
		const curlSignals: Array<AbortSignal | undefined> = [];
		const fakeFetchCurl: CurlFetch = async (_url, init) => {
			curlSignals.push(init?.signal);
			throw curlError;
		};
		const fakeFetch: typeof fetch = (_input, init) =>
			new Promise((_resolve, reject) => {
				const signal = requireSignal(init);
				signal.addEventListener("abort", () => reject(signal.reason), { once: true });
			});
		const logError = jest.fn();
		const crawlArticle = initCrawl({
			fetch: fakeFetch,
			fetchCurl: fakeFetchCurl,
			logError,
			fetchTimeouts: { headersMs: 15, bodyMs: 5000 },
		});

		const result = await crawlArticle({ url: "https://example.com/huge.pdf" });

		expect(result).toEqual({ status: "failed" });
		expect(logError).toHaveBeenCalledWith(
			"[CrawlArticle] Network error for https://example.com/huge.pdf",
			curlError,
		);
		expect(curlSignals).toEqual([undefined]);
	});

	it("aborts with a TimeoutError when the body is not fully read within the body budget", async () => {
		const fakeFetch: typeof fetch = async (_input, init) => {
			const signal = requireSignal(init);
			const body = new ReadableStream<Uint8Array>({
				start(streamController) {
					streamController.enqueue(new Uint8Array(Buffer.from("<html>")));
					signal.addEventListener("abort", () => streamController.error(signal.reason), { once: true });
				},
			});
			return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
		};
		const logError = jest.fn();
		const crawlArticle = initCrawl({
			fetch: fakeFetch,
			logError,
			fetchTimeouts: { headersMs: 5000, bodyMs: 15 },
		});

		const result = await crawlArticle({ url: "https://example.com" });

		expect(result).toEqual({ status: "failed" });
		expect(logError).toHaveBeenCalledTimes(1);
		const loggedError = logError.mock.calls[0][1];
		assert(loggedError instanceof Error, "Expected the body timeout to be logged as an Error");
		expect(loggedError.name).toBe("TimeoutError");
		expect(loggedError.message).toBe("body not fully read within 15ms");
	});

	it("materialises a body that takes longer than the headers budget (slow large PDF) and defers it as unsupported", async () => {
		const chunkSize = Math.ceil(PDF_MAGIC_BUFFER.length / 3);
		const chunks = [
			new Uint8Array(PDF_MAGIC_BUFFER.subarray(0, chunkSize)),
			new Uint8Array(PDF_MAGIC_BUFFER.subarray(chunkSize, chunkSize * 2)),
			new Uint8Array(PDF_MAGIC_BUFFER.subarray(chunkSize * 2)),
		];
		let delivered = 0;
		const fakeFetch: typeof fetch = async () => {
			const body = new ReadableStream<Uint8Array>({
				async pull(streamController) {
					await delay(20);
					streamController.enqueue(chunks[delivered]);
					delivered += 1;
					if (delivered === chunks.length) streamController.close();
				},
			});
			return new Response(body, { status: 200, headers: { "content-type": "application/pdf" } });
		};
		const crawlArticle = initCrawl({
			fetch: fakeFetch,
			fetchTimeouts: { headersMs: 25, bodyMs: 5000 },
		});

		const result = await crawlArticle({ url: "https://example.com/report.pdf" });

		expect(delivered).toBe(3);
		expect(result).toEqual({
			status: "unsupported",
			reason: "unsupported content type: application/pdf",
		});
	});
});

describe("parseHtmlFromBuffer — thumbnailUrl extraction", () => {
	const throwingCrawlFetch: CrawlFetch = async () => {
		throw new Error("crawlFetch must not be invoked when fetchThumbnail is off");
	};

	async function parse(html: string, url = "https://example.com"): Promise<CrawlArticleResult> {
		return parseHtmlFromBuffer({
			buffer: Buffer.from(html),
			bodyHash: createHash("sha256").update(Buffer.from(html)).digest("hex"),
			response: new Response(null, {}),
			url,
			crawlFetch: throwingCrawlFetch,
			logError: noopLogError,
			logInfo: noopLogInfo,
		});
	}

	it("extracts og:image as thumbnailUrl", async () => {
		const result = await parse('<html><head><meta property="og:image" content="https://example.com/og.jpg"></head></html>');
		assertFetched(result);
		expect(result.thumbnailUrl).toBe("https://example.com/og.jpg");
	});

	it("extracts twitter:image when og:image is absent", async () => {
		const result = await parse('<html><head><meta name="twitter:image" content="https://example.com/tw.jpg"></head></html>');
		assertFetched(result);
		expect(result.thumbnailUrl).toBe("https://example.com/tw.jpg");
	});

	it("prefers og:image over twitter:image", async () => {
		const result = await parse('<html><head><meta property="og:image" content="https://example.com/og.jpg"><meta name="twitter:image" content="https://example.com/tw.jpg"></head></html>');
		assertFetched(result);
		expect(result.thumbnailUrl).toBe("https://example.com/og.jpg");
	});

	it("falls back to the first body img when no meta tags exist", async () => {
		const result = await parse('<html><body><img src="https://example.com/photo.jpg"><img src="https://example.com/second.jpg"></body></html>');
		assertFetched(result);
		expect(result.thumbnailUrl).toBe("https://example.com/photo.jpg");
	});

	it("returns thumbnailUrl undefined when no images exist", async () => {
		const result = await parse("<html><head></head><body><p>No images</p></body></html>");
		assertFetched(result);
		expect(result.thumbnailUrl).toBeUndefined();
	});

	it("rejects data: and javascript: URIs", async () => {
		const result = await parse('<html><head><meta property="og:image" content="data:image/png;base64,abc"></head><body><img src="javascript:alert(1)"></body></html>');
		assertFetched(result);
		expect(result.thumbnailUrl).toBeUndefined();
	});

	it("resolves relative og:image against the article URL", async () => {
		const result = await parse('<html><head><meta property="og:image" content="/images/og.jpg"></head></html>', "https://example.com/post");
		assertFetched(result);
		expect(result.thumbnailUrl).toBe("https://example.com/images/og.jpg");
	});

	it("surfaces etag and last-modified from the response headers", async () => {
		const bodyHash = createHash("sha256").update(Buffer.from("<html></html>")).digest("hex");
		const result = await parseHtmlFromBuffer({
			buffer: Buffer.from("<html></html>"),
			bodyHash,
			response: new Response(null, { headers: { etag: '"v1"', "last-modified": "Wed, 21 Oct 2025 07:28:00 GMT" } }),
			url: "https://example.com",
			crawlFetch: throwingCrawlFetch,
			logError: noopLogError,
			logInfo: noopLogInfo,
		});
		expect(result).toEqual({
			status: "fetched",
			html: "<html></html>",
			etag: '"v1"',
			lastModified: "Wed, 21 Oct 2025 07:28:00 GMT",
			bodyHash,
		});
	});
});

describe("parseHtmlFromBuffer — thumbnail prefetch (fetchThumbnail opt-in)", () => {
	const articleHtml = `<html><head><meta property="og:image" content="https://cdn.example.com/thumb.jpg"></head><body></body></html>`;
	const imageBytes = Buffer.from([0xff, 0xd8, 0xff]);

	function parseWithImage(input: {
		html?: string;
		fetchThumbnail?: boolean;
		crawlFetch: CrawlFetch;
		logError?: (message: string, error?: Error) => void;
		logInfo?: (message: string) => void;
	}): Promise<CrawlArticleResult> {
		const buffer = Buffer.from(input.html ?? articleHtml);
		return parseHtmlFromBuffer({
			buffer,
			bodyHash: createHash("sha256").update(buffer).digest("hex"),
			response: new Response(null, {}),
			url: "https://example.com/article",
			fetchThumbnail: input.fetchThumbnail ?? true,
			crawlFetch: input.crawlFetch,
			logError: input.logError ?? noopLogError,
			logInfo: input.logInfo ?? noopLogInfo,
		});
	}

	/** crawlFetch fake that serves the thumbnail image (the article body comes
	 * from the buffer, so only the image request flows through crawlFetch). */
	function imageCrawlFetch(respond: (url: string, init?: Parameters<CrawlFetch>[1]) => Response | (() => Response)): CrawlFetch {
		return async (url, init) => {
			const out = respond(url, init);
			return typeof out === "function" ? out() : out;
		};
	}

	it("does not fetch a thumbnail when fetchThumbnail is false", async () => {
		let calls = 0;
		const crawlFetch: CrawlFetch = async () => { calls += 1; return new Response(null, { status: 200 }); };
		const result = await parseWithImage({ fetchThumbnail: false, crawlFetch });

		assertFetched(result);
		expect(calls).toBe(0);
		expect(result.thumbnailUrl).toBe("https://cdn.example.com/thumb.jpg");
		expect(result.thumbnailImage).toBeUndefined();
	});

	it("returns thumbnailImage when the og:image fetches successfully", async () => {
		const crawlFetch = imageCrawlFetch((url) => {
			expect(url).toBe("https://cdn.example.com/thumb.jpg");
			return new Response(imageBytes, {
				status: 200,
				headers: { "content-type": "image/jpeg", "content-length": String(imageBytes.length) },
			});
		});
		const result = await parseWithImage({ crawlFetch });

		assertFetched(result);
		expect(result.thumbnailImage).toEqual({
			body: imageBytes,
			contentType: "image/jpeg",
			url: "https://cdn.example.com/thumb.jpg",
			extension: ".jpg",
		});
	});

	it("sends an image Accept header when fetching the thumbnail", async () => {
		let thumbnailInit: Parameters<CrawlFetch>[1];
		const crawlFetch = imageCrawlFetch((_url, init) => {
			thumbnailInit = init;
			return new Response(imageBytes, { status: 200, headers: { "content-type": "image/jpeg" } });
		});
		await parseWithImage({ crawlFetch });

		expect(thumbnailInit?.headers?.accept).toBe("image/*,*/*;q=0.8");
	});

	it("returns thumbnailImage undefined when the article has no thumbnail URL", async () => {
		const crawlFetch: CrawlFetch = async () => { throw new Error("should not fetch"); };
		const result = await parseWithImage({
			html: "<html><head><title>No image</title></head><body></body></html>",
			crawlFetch,
		});

		assertFetched(result);
		expect(result.thumbnailImage).toBeUndefined();
	});

	it("logs at info and returns undefined when the thumbnail request fails with a non-recoverable 403", async () => {
		const crawlFetch = imageCrawlFetch(() => new Response(null, { status: 403 }));
		const logError = jest.fn();
		const logInfo = jest.fn();
		const result = await parseWithImage({ crawlFetch, logError, logInfo });

		assertFetched(result);
		expect(result.thumbnailImage).toBeUndefined();
		expect(logInfo).toHaveBeenCalledWith("[CrawlArticle] Thumbnail HTTP 403 for https://cdn.example.com/thumb.jpg");
		expect(logError).not.toHaveBeenCalled();
	});

	it("logs and returns undefined when the thumbnail content-type is not an image", async () => {
		const crawlFetch = imageCrawlFetch(() => new Response("not-an-image", { status: 200, headers: { "content-type": "text/html" } }));
		const logError = jest.fn();
		const result = await parseWithImage({ crawlFetch, logError });

		assertFetched(result);
		expect(result.thumbnailImage).toBeUndefined();
		expect(logError).toHaveBeenCalledWith('[CrawlArticle] Thumbnail unexpected Content-Type "text/html" for https://cdn.example.com/thumb.jpg');
	});

	it("logs and returns undefined when content-length exceeds the cap", async () => {
		const oversizedLength = String(6 * 1024 * 1024);
		const crawlFetch = imageCrawlFetch(() => new Response(imageBytes, {
			status: 200,
			headers: { "content-type": "image/jpeg", "content-length": oversizedLength },
		}));
		const logError = jest.fn();
		const result = await parseWithImage({ crawlFetch, logError });

		assertFetched(result);
		expect(result.thumbnailImage).toBeUndefined();
		expect(logError).toHaveBeenCalledWith(`[CrawlArticle] Thumbnail too large (${oversizedLength} bytes) for https://cdn.example.com/thumb.jpg`);
	});

	it("logs and returns undefined when the downloaded body exceeds the cap", async () => {
		const oversizedBody = Buffer.alloc(6 * 1024 * 1024, 0);
		const crawlFetch = imageCrawlFetch(() => new Response(oversizedBody, { status: 200, headers: { "content-type": "image/jpeg" } }));
		const logError = jest.fn();
		const result = await parseWithImage({ crawlFetch, logError });

		assertFetched(result);
		expect(result.thumbnailImage).toBeUndefined();
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] Thumbnail too large for https://cdn.example.com/thumb.jpg");
	});

	it("logs the Error instance when the thumbnail fetch throws a network error", async () => {
		const networkError = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
		const crawlFetch: CrawlFetch = async () => { throw networkError; };
		const logError = jest.fn();
		const result = await parseWithImage({ crawlFetch, logError });

		assertFetched(result);
		expect(result.thumbnailImage).toBeUndefined();
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] Thumbnail network error for https://cdn.example.com/thumb.jpg", networkError);
	});

	it("logs undefined when the thumbnail fetch throws a non-Error value", async () => {
		const crawlFetch: CrawlFetch = async () => { throw "boom"; };
		const logError = jest.fn();
		const result = await parseWithImage({ crawlFetch, logError });

		assertFetched(result);
		expect(result.thumbnailImage).toBeUndefined();
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] Thumbnail network error for https://cdn.example.com/thumb.jpg", undefined);
	});

	it("cascades to the second candidate when the first og:image fetch fails", async () => {
		const html = `<html><head>
			<meta property="og:image" content="https://dead.example.com/og.jpg">
		</head><body>
			<img src="https://cdn.example.com/body.jpg">
		</body></html>`;
		const crawlFetch = imageCrawlFetch((url) => {
			if (url === "https://dead.example.com/og.jpg") return new Response(null, { status: 404 });
			return new Response(imageBytes, { status: 200, headers: { "content-type": "image/jpeg" } });
		});
		const result = await parseWithImage({ html, crawlFetch });

		assertFetched(result);
		expect(result.thumbnailUrl).toBe("https://dead.example.com/og.jpg");
		expect(result.thumbnailImage).toEqual({
			body: imageBytes,
			contentType: "image/jpeg",
			url: "https://cdn.example.com/body.jpg",
			extension: ".jpg",
		});
	});
});

describe("parsePdfFromBuffer", () => {
	function htmlResponse(headers: Record<string, string> = {}): Response {
		return new Response(null, { headers });
	}

	it("returns the extracted html with captured validators on success", async () => {
		const extractPdf: ExtractPdf = async () => ({
			kind: "fetched",
			html: "<html><body><p>PDF body</p></body></html>",
			title: "doc",
		});
		const bodyHash = createHash("sha256").update(PDF_MAGIC_BUFFER).digest("hex");
		const result = await parsePdfFromBuffer({
			buffer: PDF_MAGIC_BUFFER,
			bodyHash,
			response: htmlResponse({ etag: '"pdf-1"', "last-modified": "Wed, 21 Oct 2025 07:28:00 GMT" }),
			url: "https://example.com/doc.pdf",
			maxPdfBytes: PDF_BYTES_CAP,
			extractPdf,
			logError: noopLogError,
		});

		expect(result).toEqual({
			status: "fetched",
			html: "<html><body><p>PDF body</p></body></html>",
			etag: '"pdf-1"',
			lastModified: "Wed, 21 Oct 2025 07:28:00 GMT",
			bodyHash,
		});
	});

	it("forwards the onProgress callback through to the extractor", async () => {
		const onProgress = jest.fn();
		const extractPdf: ExtractPdf = async (params) => {
			params.onProgress?.({ partIndex: 1, partCount: 3, stage: "comprehensive-extracting" });
			return { kind: "fetched", html: "<html><body><p>ok</p></body></html>", title: "ok" };
		};
		await parsePdfFromBuffer({
			buffer: PDF_MAGIC_BUFFER,
			bodyHash: createHash("sha256").update(PDF_MAGIC_BUFFER).digest("hex"),
			response: htmlResponse(),
			url: "https://example.com/doc.pdf",
			maxPdfBytes: PDF_BYTES_CAP,
			extractPdf,
			onProgress,
			logError: noopLogError,
		});

		expect(onProgress).toHaveBeenCalledWith({ partIndex: 1, partCount: 3, stage: "comprehensive-extracting" });
	});

	it("returns unsupported with the extractor reason when extraction fails", async () => {
		const extractPdf: ExtractPdf = async () => ({ kind: "failed", reason: PDF_EXTRACT_FAILURE_REASON });
		const logError = jest.fn();
		const result = await parsePdfFromBuffer({
			buffer: PDF_MAGIC_BUFFER,
			bodyHash: createHash("sha256").update(PDF_MAGIC_BUFFER).digest("hex"),
			response: htmlResponse(),
			url: "https://example.com/scan.pdf",
			maxPdfBytes: PDF_BYTES_CAP,
			extractPdf,
			logError,
		});

		expect(result).toEqual({ status: "unsupported", reason: `pdf extraction failed: ${PDF_EXTRACT_FAILURE_REASON}` });
		expect(logError).toHaveBeenCalledWith(
			`[CrawlArticle] PDF extraction failed for https://example.com/scan.pdf: ${PDF_EXTRACT_FAILURE_REASON}`,
		);
	});

	it("drops etag and last-modified from the result when the caller has no Response (client-uploaded PDF bytes)", async () => {
		const extractPdf: ExtractPdf = async () => ({
			kind: "fetched",
			html: "<html><body><p>PDF body</p></body></html>",
			title: "doc",
		});
		const bodyHash = createHash("sha256").update(PDF_MAGIC_BUFFER).digest("hex");
		const result = await parsePdfFromBuffer({
			buffer: PDF_MAGIC_BUFFER,
			bodyHash,
			response: undefined,
			url: "https://example.com/doc.pdf",
			maxPdfBytes: PDF_BYTES_CAP,
			extractPdf,
			logError: noopLogError,
		});

		expect(result).toEqual({
			status: "fetched",
			html: "<html><body><p>PDF body</p></body></html>",
			etag: undefined,
			lastModified: undefined,
			bodyHash,
		});
	});

	it("returns unsupported with the byte count when the body exceeds the cap, without invoking the extractor", async () => {
		const oversize = Buffer.concat([Buffer.from("%PDF-1.4"), Buffer.alloc(PDF_BYTES_CAP + 1, 0x20)]);
		const extractPdf = jest.fn<ReturnType<ExtractPdf>, Parameters<ExtractPdf>>();
		const logError = jest.fn();
		const result = await parsePdfFromBuffer({
			buffer: oversize,
			bodyHash: createHash("sha256").update(oversize).digest("hex"),
			response: htmlResponse(),
			url: "https://example.com/huge.pdf",
			maxPdfBytes: PDF_BYTES_CAP,
			extractPdf,
			logError,
		});

		expect(result).toEqual({ status: "unsupported", reason: `pdf body too large: ${oversize.length} bytes` });
		expect(extractPdf).not.toHaveBeenCalled();
		expect(logError).toHaveBeenCalledWith(`[CrawlArticle] PDF body too large (${oversize.length} bytes) for https://example.com/huge.pdf`);
	});
});
