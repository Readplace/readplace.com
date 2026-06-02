import assert from "node:assert";
import {
	DEFAULT_CRAWL_HEADERS,
	initCrawlArticle,
	parseHtmlFromBuffer,
	parsePdfFromBuffer,
} from "./crawl-article";
import type { CrawlArticleResult } from "./crawl-article.types";
import type { CrawlFetch } from "./crawl-fetch";
import { initCrawlFetch } from "./crawl-fetch";
import type { fetchCurl } from "./curl-fetch";
import type { fetchH2 } from "./h2-fetch";
import type { ExtractPdf } from "./pdf-extract.types";

jest.mock("./pdf-page-limits", () => ({
	MAX_PDF_BYTES: { bytes: 25 * 1024 * 1024, label: "25 MB" },
	MAX_PDF_PAGES: 300,
}));

const PDF_EXTRACT_FAILURE_REASON = "synthetic extractor failure";
const PDF_MAGIC_BUFFER = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(64, 0x20)]);

const noopLogError = () => {};

// Never reached in unit tests: curl/h2 fallback only fires on block-class
// responses/errors, which these fixtures don't produce. The fallback chain has
// its own coverage in crawl-fetch/curl-fetch/h2-fetch tests.
const stubFetchCurl: typeof fetchCurl = async () => {
	throw new Error("stub fetchCurl: not invoked");
};
const stubFetchH2: typeof fetchH2 = async () => {
	throw new Error("stub fetchH2: not invoked");
};

/** Wrap a fake origin `fetch` in the real crawl-fetch stack so tests exercise
 * the same header-merge + fallback wiring production uses. */
function buildCrawlFetch(overrides: {
	fetch: typeof fetch;
	fetchCurl?: typeof fetchCurl;
	fetchH2?: typeof fetchH2;
}): CrawlFetch {
	return initCrawlFetch({
		fetch: overrides.fetch,
		personas: [{ name: "test-default", headers: { ...DEFAULT_CRAWL_HEADERS } }],
		fetchCurl: overrides.fetchCurl ?? stubFetchCurl,
		fetchH2: overrides.fetchH2 ?? stubFetchH2,
	});
}

function initCrawl(overrides: {
	fetch: typeof fetch;
	extractPdf?: ExtractPdf;
	logError?: (message: string, error?: Error) => void;
	fetchCurl?: typeof fetchCurl;
	fetchH2?: typeof fetchH2;
}) {
	return initCrawlArticle({
		crawlFetch: buildCrawlFetch(overrides),
		extractPdf: overrides.extractPdf,
		logError: overrides.logError ?? noopLogError,
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

	it("returns unsupported for a PDF body when constructed without an extractPdf dep (simple-only path)", async () => {
		const fakeFetch: typeof fetch = async () =>
			new Response(PDF_MAGIC_BUFFER, { status: 200, headers: { "content-type": "application/pdf" } });
		const logError = jest.fn();
		const crawlArticle = initCrawl({ fetch: fakeFetch, logError });

		const result = await crawlArticle({ url: "https://example.com/doc.pdf" });

		expect(result).toEqual({ status: "unsupported", reason: "unsupported content type: application/pdf" });
		expect(logError).toHaveBeenCalledWith('[CrawlArticle] Unsupported content-type "application/pdf" for https://example.com/doc.pdf');
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

	it("returns failed and logs the HTTP status on a non-ok, non-304 response", async () => {
		const fakeFetch: typeof fetch = async () => new Response(null, { status: 500 });
		const logError = jest.fn();
		const crawlArticle = initCrawl({ fetch: fakeFetch, logError });

		const result = await crawlArticle({ url: "https://example.com" });

		expect(result).toEqual({ status: "failed" });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] HTTP 500 for https://example.com");
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
});

describe("parseHtmlFromBuffer — thumbnailUrl extraction", () => {
	const throwingCrawlFetch: CrawlFetch = async () => {
		throw new Error("crawlFetch must not be invoked when fetchThumbnail is off");
	};

	async function parse(html: string, url = "https://example.com"): Promise<CrawlArticleResult> {
		return parseHtmlFromBuffer({
			buffer: Buffer.from(html),
			response: new Response(null, {}),
			url,
			crawlFetch: throwingCrawlFetch,
			logError: noopLogError,
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
		const result = await parseHtmlFromBuffer({
			buffer: Buffer.from("<html></html>"),
			response: new Response(null, { headers: { etag: '"v1"', "last-modified": "Wed, 21 Oct 2025 07:28:00 GMT" } }),
			url: "https://example.com",
			crawlFetch: throwingCrawlFetch,
			logError: noopLogError,
		});
		expect(result).toEqual({
			status: "fetched",
			html: "<html></html>",
			etag: '"v1"',
			lastModified: "Wed, 21 Oct 2025 07:28:00 GMT",
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
	}): Promise<CrawlArticleResult> {
		return parseHtmlFromBuffer({
			buffer: Buffer.from(input.html ?? articleHtml),
			response: new Response(null, {}),
			url: "https://example.com/article",
			fetchThumbnail: input.fetchThumbnail ?? true,
			crawlFetch: input.crawlFetch,
			logError: input.logError ?? noopLogError,
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

	it("logs and returns undefined when the thumbnail request fails", async () => {
		const crawlFetch = imageCrawlFetch(() => new Response(null, { status: 403 }));
		const logError = jest.fn();
		const result = await parseWithImage({ crawlFetch, logError });

		assertFetched(result);
		expect(result.thumbnailImage).toBeUndefined();
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] Thumbnail HTTP 403 for https://cdn.example.com/thumb.jpg");
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
		expect(logError).toHaveBeenCalledWith(`[CrawlArticle] Thumbnail too large (${oversizedBody.length} bytes) for https://cdn.example.com/thumb.jpg`);
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
		const result = await parsePdfFromBuffer({
			buffer: PDF_MAGIC_BUFFER,
			response: htmlResponse({ etag: '"pdf-1"', "last-modified": "Wed, 21 Oct 2025 07:28:00 GMT" }),
			url: "https://example.com/doc.pdf",
			extractPdf,
			logError: noopLogError,
		});

		expect(result).toEqual({
			status: "fetched",
			html: "<html><body><p>PDF body</p></body></html>",
			etag: '"pdf-1"',
			lastModified: "Wed, 21 Oct 2025 07:28:00 GMT",
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
			response: htmlResponse(),
			url: "https://example.com/doc.pdf",
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
			response: htmlResponse(),
			url: "https://example.com/scan.pdf",
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
		const result = await parsePdfFromBuffer({
			buffer: PDF_MAGIC_BUFFER,
			response: undefined,
			url: "https://example.com/doc.pdf",
			extractPdf,
			logError: noopLogError,
		});

		expect(result).toEqual({
			status: "fetched",
			html: "<html><body><p>PDF body</p></body></html>",
			etag: undefined,
			lastModified: undefined,
		});
	});

	it("returns unsupported with the byte count when the body exceeds the cap, without invoking the extractor", async () => {
		const oversize = Buffer.concat([Buffer.from("%PDF-1.4"), Buffer.alloc(25 * 1024 * 1024 + 1, 0x20)]);
		const extractPdf = jest.fn<ReturnType<ExtractPdf>, Parameters<ExtractPdf>>();
		const logError = jest.fn();
		const result = await parsePdfFromBuffer({
			buffer: oversize,
			response: htmlResponse(),
			url: "https://example.com/huge.pdf",
			extractPdf,
			logError,
		});

		expect(result).toEqual({ status: "unsupported", reason: `pdf body too large: ${oversize.length} bytes` });
		expect(extractPdf).not.toHaveBeenCalled();
		expect(logError).toHaveBeenCalledWith(`[CrawlArticle] PDF body too large (${oversize.length} bytes) for https://example.com/huge.pdf`);
	});
});
