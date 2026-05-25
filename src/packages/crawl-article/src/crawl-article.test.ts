import assert from "node:assert";
import {
	initComprehensiveCrawl,
	initCrawlArticle,
	initSimpleCrawl,
	DEFAULT_CRAWL_HEADERS,
} from "./crawl-article";
import type { CrawlArticleResult } from "./crawl-article.types";
import { initCrawlFetch } from "./crawl-fetch";
import type { fetchCurl } from "./curl-fetch";
import type { fetchH2 } from "./h2-fetch";
import type { ExtractPdf } from "./pdf-extract.types";

jest.mock("./pdf-page-limits", () => ({
	MAX_PDF_BYTES: { bytes: 25 * 1024 * 1024, label: "25 MB" },
	MAX_PDF_PAGES: 300,
}));

const PDF_EXTRACT_FAILURE_REASON = "synthetic extractor failure";

const noopLogError = () => {};

const identityPreprocessUrl = async (url: string) => url;

// Default stub: never reaches real network in unit tests. Tests that want to
// verify fallback behaviour pass a curl impl explicitly via overrides.fetchCurl.
const stubFetchCurl: typeof fetchCurl = async () => {
	throw new Error("stub fetchCurl: not invoked");
};

const stubFetchH2: typeof fetchH2 = async () => {
	throw new Error("stub fetchH2: not invoked");
};

// Default stub: PDF extraction is exercised by its own tests via `initCrawl`
// overrides — the HTML-path tests must not silently invoke a real extractor.
const stubExtractPdf: ExtractPdf = async () => {
	throw new Error("stub extractPdf: not invoked");
};

function initCrawl(overrides?: {
	fetch?: typeof fetch;
	logError?: (message: string, error?: Error) => void;
	fetchCurl?: typeof fetchCurl;
	fetchH2?: typeof fetchH2;
	extractPdf?: ExtractPdf;
}) {
	const defaultFetch: typeof fetch = async () =>
		new Response("<html></html>", {
			status: 200,
			headers: { "content-type": "text/html" },
		});
	const crawlFetch = initCrawlFetch({
		fetch: overrides?.fetch ?? defaultFetch,
		personas: [{ name: "test-default", headers: { ...DEFAULT_CRAWL_HEADERS } }],
		fetchCurl: overrides?.fetchCurl ?? stubFetchCurl,
		fetchH2: overrides?.fetchH2 ?? stubFetchH2,
	});
	const logError = overrides?.logError ?? noopLogError;
	const simpleCrawl = initSimpleCrawl({ crawlFetch, preprocessUrl: identityPreprocessUrl, logError });
	const comprehensiveCrawl = initComprehensiveCrawl({
		crawlFetch,
		preprocessUrl: identityPreprocessUrl,
		extractPdf: overrides?.extractPdf ?? stubExtractPdf,
		logError,
	});
	return initCrawlArticle({ simpleCrawl, comprehensiveCrawl });
}

function initSimple(overrides?: {
	fetch?: typeof fetch;
	logError?: (message: string, error?: Error) => void;
	fetchCurl?: typeof fetchCurl;
	fetchH2?: typeof fetchH2;
}) {
	const defaultFetch: typeof fetch = async () =>
		new Response("<html></html>", {
			status: 200,
			headers: { "content-type": "text/html" },
		});
	const crawlFetch = initCrawlFetch({
		fetch: overrides?.fetch ?? defaultFetch,
		personas: [{ name: "test-default", headers: { ...DEFAULT_CRAWL_HEADERS } }],
		fetchCurl: overrides?.fetchCurl ?? stubFetchCurl,
		fetchH2: overrides?.fetchH2 ?? stubFetchH2,
	});
	return initSimpleCrawl({
		crawlFetch,
		preprocessUrl: identityPreprocessUrl,
		logError: overrides?.logError ?? noopLogError,
	});
}

function initComprehensive(overrides?: {
	fetch?: typeof fetch;
	logError?: (message: string, error?: Error) => void;
	fetchCurl?: typeof fetchCurl;
	fetchH2?: typeof fetchH2;
	extractPdf?: ExtractPdf;
}) {
	const defaultFetch: typeof fetch = async () =>
		new Response(Buffer.from("%PDF-1.4\n"), {
			status: 200,
			headers: { "content-type": "application/pdf" },
		});
	const crawlFetch = initCrawlFetch({
		fetch: overrides?.fetch ?? defaultFetch,
		personas: [{ name: "test-default", headers: { ...DEFAULT_CRAWL_HEADERS } }],
		fetchCurl: overrides?.fetchCurl ?? stubFetchCurl,
		fetchH2: overrides?.fetchH2 ?? stubFetchH2,
	});
	return initComprehensiveCrawl({
		crawlFetch,
		preprocessUrl: identityPreprocessUrl,
		extractPdf: overrides?.extractPdf ?? stubExtractPdf,
		logError: overrides?.logError ?? noopLogError,
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

describe("initSimpleCrawl — regular first-save fetch", () => {
	it("returns status 'fetched' with html and captured headers on 200", async () => {
		const fakeFetch: typeof fetch = async () =>
			new Response("<html>Hello</html>", {
				status: 200,
				headers: {
					"content-type": "text/html",
					etag: '"abc123"',
					"last-modified": "Wed, 21 Oct 2025 07:28:00 GMT",
				},
			});
		const simpleCrawl = initSimple({ fetch: fakeFetch });

		const result = await simpleCrawl({ url: "https://example.com" });

		expect(result).toEqual({
			status: "fetched",
			html: "<html>Hello</html>",
			etag: '"abc123"',
			lastModified: "Wed, 21 Oct 2025 07:28:00 GMT",
		});
	});

	it("returns status 'fetched' with undefined etag/lastModified when origin sends none", async () => {
		const fakeFetch: typeof fetch = async () =>
			new Response("<html>Hello</html>", {
				status: 200,
				headers: { "content-type": "text/html" },
			});
		const simpleCrawl = initSimple({ fetch: fakeFetch });

		const result = await simpleCrawl({ url: "https://example.com" });

		expect(result).toEqual({
			status: "fetched",
			html: "<html>Hello</html>",
			etag: undefined,
			lastModified: undefined,
		});
	});

	it("sends the browser-like default headers on the first fetch", async () => {
		let capturedInit: RequestInit | undefined;
		const fakeFetch: typeof fetch = async (_input, init) => {
			capturedInit = init;
			return new Response("<html></html>", {
				status: 200,
				headers: { "content-type": "text/html" },
			});
		};
		const simpleCrawl = initSimple({ fetch: fakeFetch });

		await simpleCrawl({ url: "https://example.com" });

		expect(plainHeaders(capturedInit)).toEqual({
			"user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
			accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
			"accept-language": "en-US,en;q=0.9",
		});
	});

	it("returns status 'fetched' when content-type is application/xhtml+xml", async () => {
		const fakeFetch: typeof fetch = async () =>
			new Response("<html>XHTML content</html>", {
				status: 200,
				headers: { "content-type": "application/xhtml+xml; charset=utf-8" },
			});
		const simpleCrawl = initSimple({ fetch: fakeFetch });

		const result = await simpleCrawl({ url: "https://example.com" });

		expect(result).toEqual({
			status: "fetched",
			html: "<html>XHTML content</html>",
			etag: undefined,
			lastModified: undefined,
		});
	});

	it("passes the URL through to the fetch function unchanged", async () => {
		let capturedInput: unknown;
		const fakeFetch: typeof fetch = async (input) => {
			capturedInput = input;
			return new Response("<html></html>", {
				status: 200,
				headers: { "content-type": "text/html" },
			});
		};
		const simpleCrawl = initSimple({ fetch: fakeFetch });

		await simpleCrawl({ url: "https://example.com/article" });

		expect(capturedInput).toBe("https://example.com/article");
	});
});

describe("initSimpleCrawl — TTL refresh with conditional headers", () => {
	it("returns status 'not-modified' on 304 response", async () => {
		const fakeFetch: typeof fetch = async () => new Response(null, { status: 304 });
		const simpleCrawl = initSimple({ fetch: fakeFetch });

		const result = await simpleCrawl({
			url: "https://example.com",
			etag: '"abc123"',
		});

		expect(result).toEqual({ status: "not-modified" });
	});

	it("returns status 'fetched' with fresh headers on 200 conditional response", async () => {
		const fakeFetch: typeof fetch = async () =>
			new Response("<html>New content</html>", {
				status: 200,
				headers: {
					"content-type": "text/html",
					etag: '"def456"',
					"last-modified": "Thu, 22 Oct 2025 10:00:00 GMT",
				},
			});
		const simpleCrawl = initSimple({ fetch: fakeFetch });

		const result = await simpleCrawl({
			url: "https://example.com",
			etag: '"abc123"',
			lastModified: "Wed, 21 Oct 2025 07:28:00 GMT",
		});

		expect(result).toEqual({
			status: "fetched",
			html: "<html>New content</html>",
			etag: '"def456"',
			lastModified: "Thu, 22 Oct 2025 10:00:00 GMT",
		});
	});

	it("sends If-None-Match when etag is provided, alongside defaults", async () => {
		let capturedInit: RequestInit | undefined;
		const fakeFetch: typeof fetch = async (_input, init) => {
			capturedInit = init;
			return new Response(null, { status: 304 });
		};
		const simpleCrawl = initSimple({ fetch: fakeFetch });

		await simpleCrawl({ url: "https://example.com", etag: '"abc123"' });

		const headers = plainHeaders(capturedInit);
		expect(headers["if-none-match"]).toBe('"abc123"');
		expect(headers["user-agent"]).toBeTruthy();
		expect(headers["accept-language"]).toBeTruthy();
	});

	it("sends If-Modified-Since when lastModified is provided, alongside defaults", async () => {
		let capturedInit: RequestInit | undefined;
		const fakeFetch: typeof fetch = async (_input, init) => {
			capturedInit = init;
			return new Response(null, { status: 304 });
		};
		const simpleCrawl = initSimple({ fetch: fakeFetch });

		await simpleCrawl({
			url: "https://example.com",
			lastModified: "Wed, 21 Oct 2025 07:28:00 GMT",
		});

		const headers = plainHeaders(capturedInit);
		expect(headers["if-modified-since"]).toBe("Wed, 21 Oct 2025 07:28:00 GMT");
		expect(headers["user-agent"]).toBeTruthy();
	});
});

describe("initSimpleCrawl — X/Twitter routing", () => {
	it("routes tweet URLs through the oembed preprocessor instead of the HTML path", async () => {
		const fakeFetch: typeof fetch = async (input) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			expect(url).toMatch(/^https:\/\/publish\.twitter\.com\/oembed/);
			return new Response(JSON.stringify({ author_name: "User", html: "<blockquote>x</blockquote>" }), {
				status: 200, headers: { "content-type": "application/json" },
			});
		};
		const simpleCrawl = initSimple({ fetch: fakeFetch });

		const result = await simpleCrawl({ url: "https://x.com/user/status/123" });

		expect(result.status).toBe("fetched");
	});
});

describe("initSimpleCrawl — failure modes", () => {
	it("returns status 'failed' and logs HTTP status when response is not ok and not 304", async () => {
		const fakeFetch: typeof fetch = async () => new Response(null, { status: 403 });
		const fetchH2Stub: typeof fetchH2 = async () => new Response(null, { status: 403 });
		const fetchCurlStub: typeof fetchCurl = async () => new Response(null, { status: 403 });
		const logError = jest.fn();
		const simpleCrawl = initSimple({ fetch: fakeFetch, fetchH2: fetchH2Stub, fetchCurl: fetchCurlStub, logError });

		const result = await simpleCrawl({ url: "https://example.com" });

		expect(result).toEqual({ status: "failed" });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] HTTP 403 for https://example.com");
	});

	it("returns status 'unsupported' with the content-type reason when the origin serves a non-html body", async () => {
		const fakeFetch: typeof fetch = async () =>
			new Response("{}", {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		const logError = jest.fn();
		const simpleCrawl = initSimple({ fetch: fakeFetch, logError });

		const result = await simpleCrawl({ url: "https://example.com" });

		expect(result).toEqual({
			status: "unsupported",
			reason: "non-html content type: application/json",
		});
		expect(logError).toHaveBeenCalledWith('[CrawlArticle] Unexpected Content-Type "application/json" for https://example.com');
	});

	it("returns status 'unsupported' with an empty content-type reason when the header is missing", async () => {
		const fakeFetch: typeof fetch = async () =>
			new Response(Buffer.from("<html>Content</html>"), { status: 200, headers: {} });
		const logError = jest.fn();
		const simpleCrawl = initSimple({ fetch: fakeFetch, logError });

		const result = await simpleCrawl({ url: "https://example.com" });

		expect(result).toEqual({ status: "unsupported", reason: "non-html content type: " });
		expect(logError).toHaveBeenCalledWith('[CrawlArticle] Unexpected Content-Type "" for https://example.com');
	});

	it("returns status 'failed' and logs with the Error instance when fetch throws a clear network error (curl fallback skipped)", async () => {
		const networkError = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
		const fakeFetch: typeof fetch = async () => { throw networkError; };
		const logError = jest.fn();
		const simpleCrawl = initSimple({ fetch: fakeFetch, logError });

		const result = await simpleCrawl({ url: "https://example.com" });

		expect(result).toEqual({ status: "failed" });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] Network error for https://example.com", networkError);
	});

	it("returns status 'failed' when fetch throws a transient error and curl fallback also fails", async () => {
		const fakeFetch: typeof fetch = async () => { throw new Error("network down"); };
		const curlError = new Error("curl also failed");
		const fakeCurl: typeof fetchCurl = async () => { throw curlError; };
		const logError = jest.fn();
		const simpleCrawl = initSimple({ fetch: fakeFetch, fetchCurl: fakeCurl, logError });

		const result = await simpleCrawl({ url: "https://example.com" });

		expect(result).toEqual({ status: "failed" });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] Network error for https://example.com", curlError);
	});

	it("returns status 'failed' and logs undefined when fetch throws a non-Error value and curl fallback also fails with a non-Error", async () => {
		const fakeFetch: typeof fetch = async () => { throw "string error"; };
		const fakeCurl: typeof fetchCurl = async () => { throw "string error from curl"; };
		const logError = jest.fn();
		const simpleCrawl = initSimple({ fetch: fakeFetch, fetchCurl: fakeCurl, logError });

		const result = await simpleCrawl({ url: "https://example.com" });

		expect(result).toEqual({ status: "failed" });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] Network error for https://example.com", undefined);
	});
});

describe("initSimpleCrawl — thumbnail fetch (fetchThumbnail opt-in)", () => {
	const articleHtml = `<html><head><meta property="og:image" content="https://cdn.example.com/thumb.jpg"></head><body></body></html>`;
	const imageBytes = Buffer.from([0xff, 0xd8, 0xff]);

	function articleThenImageFetch(thumbResponse: Response | (() => Response)): typeof fetch {
		let call = 0;
		return async (input) => {
			call += 1;
			if (call === 1) {
				return new Response(articleHtml, {
					status: 200,
					headers: { "content-type": "text/html" },
				});
			}
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			expect(url).toBe("https://cdn.example.com/thumb.jpg");
			return typeof thumbResponse === "function" ? thumbResponse() : thumbResponse;
		};
	}

	function assertFetched(result: CrawlArticleResult): asserts result is CrawlArticleResult & { status: "fetched" } {
		assert(result.status === "fetched", `Expected 'fetched', got '${result.status}'`);
	}

	it("does not fetch a thumbnail when fetchThumbnail is false (default)", async () => {
		let fetchCalls = 0;
		const fakeFetch: typeof fetch = async () => {
			fetchCalls += 1;
			return new Response(articleHtml, { status: 200, headers: { "content-type": "text/html" } });
		};
		const simpleCrawl = initSimple({ fetch: fakeFetch });

		const result = await simpleCrawl({ url: "https://example.com" });

		expect(fetchCalls).toBe(1);
		assertFetched(result);
		expect(result.thumbnailUrl).toBe("https://cdn.example.com/thumb.jpg");
		expect(result.thumbnailImage).toBeUndefined();
	});

	it("returns thumbnailImage when the article has an og:image that fetches successfully", async () => {
		const fakeFetch = articleThenImageFetch(new Response(imageBytes, {
			status: 200,
			headers: { "content-type": "image/jpeg", "content-length": String(imageBytes.length) },
		}));
		const simpleCrawl = initSimple({ fetch: fakeFetch });

		const result = await simpleCrawl({ url: "https://example.com/article", fetchThumbnail: true });

		assertFetched(result);
		expect(result.thumbnailImage).toEqual({
			body: imageBytes,
			contentType: "image/jpeg",
			url: "https://cdn.example.com/thumb.jpg",
			extension: ".jpg",
		});
	});

	it("sends an image Accept header when fetching the thumbnail", async () => {
		let thumbnailInit: RequestInit | undefined;
		let call = 0;
		const fakeFetch: typeof fetch = async (_input, init) => {
			call += 1;
			if (call === 1) {
				return new Response(articleHtml, { status: 200, headers: { "content-type": "text/html" } });
			}
			thumbnailInit = init;
			return new Response(imageBytes, { status: 200, headers: { "content-type": "image/jpeg" } });
		};
		const simpleCrawl = initSimple({ fetch: fakeFetch });

		await simpleCrawl({ url: "https://example.com", fetchThumbnail: true });

		const headers = plainHeaders(thumbnailInit);
		expect(headers.accept).toBe("image/*,*/*;q=0.8");
	});

	it("returns thumbnailImage undefined when the article has no thumbnail URL", async () => {
		const fakeFetch: typeof fetch = async () =>
			new Response("<html><head><title>No image</title></head><body></body></html>", {
				status: 200,
				headers: { "content-type": "text/html" },
			});
		const simpleCrawl = initSimple({ fetch: fakeFetch });

		const result = await simpleCrawl({ url: "https://example.com", fetchThumbnail: true });

		assertFetched(result);
		expect(result.thumbnailImage).toBeUndefined();
	});

	it("logs and returns thumbnailImage undefined when the thumbnail HTTP request fails", async () => {
		const fakeFetch = articleThenImageFetch(new Response(null, { status: 403 }));
		const fetchH2Stub: typeof fetchH2 = async () => new Response(null, { status: 403 });
		const fetchCurlStub: typeof fetchCurl = async () => new Response(null, { status: 403 });
		const logError = jest.fn();
		const simpleCrawl = initSimple({ fetch: fakeFetch, fetchH2: fetchH2Stub, fetchCurl: fetchCurlStub, logError });

		const result = await simpleCrawl({ url: "https://example.com", fetchThumbnail: true });

		assertFetched(result);
		expect(result.thumbnailImage).toBeUndefined();
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] Thumbnail HTTP 403 for https://cdn.example.com/thumb.jpg");
	});

	it("logs and returns thumbnailImage undefined when the thumbnail content-type is not an image", async () => {
		const fakeFetch = articleThenImageFetch(new Response("not-an-image", {
			status: 200,
			headers: { "content-type": "text/html" },
		}));
		const logError = jest.fn();
		const simpleCrawl = initSimple({ fetch: fakeFetch, logError });

		const result = await simpleCrawl({ url: "https://example.com", fetchThumbnail: true });

		assertFetched(result);
		expect(result.thumbnailImage).toBeUndefined();
		expect(logError).toHaveBeenCalledWith('[CrawlArticle] Thumbnail unexpected Content-Type "text/html" for https://cdn.example.com/thumb.jpg');
	});

	it("logs and returns thumbnailImage undefined when content-length exceeds the cap", async () => {
		const oversizedLength = String(6 * 1024 * 1024);
		const fakeFetch = articleThenImageFetch(new Response(imageBytes, {
			status: 200,
			headers: { "content-type": "image/jpeg", "content-length": oversizedLength },
		}));
		const logError = jest.fn();
		const simpleCrawl = initSimple({ fetch: fakeFetch, logError });

		const result = await simpleCrawl({ url: "https://example.com", fetchThumbnail: true });

		assertFetched(result);
		expect(result.thumbnailImage).toBeUndefined();
		expect(logError).toHaveBeenCalledWith(`[CrawlArticle] Thumbnail too large (${oversizedLength} bytes) for https://cdn.example.com/thumb.jpg`);
	});

	it("logs and returns thumbnailImage undefined when the actual body exceeds the cap after download", async () => {
		const oversizedBody = Buffer.alloc(6 * 1024 * 1024, 0);
		const fakeFetch = articleThenImageFetch(new Response(oversizedBody, {
			status: 200,
			headers: { "content-type": "image/jpeg" },
		}));
		const logError = jest.fn();
		const simpleCrawl = initSimple({ fetch: fakeFetch, logError });

		const result = await simpleCrawl({ url: "https://example.com", fetchThumbnail: true });

		assertFetched(result);
		expect(result.thumbnailImage).toBeUndefined();
		expect(logError).toHaveBeenCalledWith(`[CrawlArticle] Thumbnail too large (${oversizedBody.length} bytes) for https://cdn.example.com/thumb.jpg`);
	});

	it("logs and returns thumbnailImage undefined when the thumbnail fetch throws a clear network error (curl fallback skipped)", async () => {
		const networkError = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
		const fakeFetch = articleThenImageFetch(() => { throw networkError; });
		const logError = jest.fn();
		const simpleCrawl = initSimple({ fetch: fakeFetch, logError });

		const result = await simpleCrawl({ url: "https://example.com", fetchThumbnail: true });

		assertFetched(result);
		expect(result.thumbnailImage).toBeUndefined();
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] Thumbnail network error for https://cdn.example.com/thumb.jpg", networkError);
	});

	it("logs with undefined when the thumbnail fetch throws a non-Error value and curl fallback also fails with a non-Error", async () => {
		const fakeFetch = articleThenImageFetch(() => { throw "boom"; });
		const fakeCurl: typeof fetchCurl = async () => { throw "boom from curl"; };
		const logError = jest.fn();
		const simpleCrawl = initSimple({ fetch: fakeFetch, fetchCurl: fakeCurl, logError });

		const result = await simpleCrawl({ url: "https://example.com", fetchThumbnail: true });

		assertFetched(result);
		expect(result.thumbnailImage).toBeUndefined();
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] Thumbnail network error for https://cdn.example.com/thumb.jpg", undefined);
	});

	it("cascades to second candidate when og:image fetch fails", async () => {
		const htmlWithDeadOgAndGoodBody = `<html><head>
			<meta property="og:image" content="https://dead.example.com/og.jpg">
		</head><body>
			<img src="https://cdn.example.com/body.jpg">
		</body></html>`;

		let call = 0;
		const fakeFetch: typeof fetch = async (input) => {
			call += 1;
			if (call === 1) {
				return new Response(htmlWithDeadOgAndGoodBody, { status: 200, headers: { "content-type": "text/html" } });
			}
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			if (url === "https://dead.example.com/og.jpg") {
				return new Response(null, { status: 404 });
			}
			return new Response(imageBytes, { status: 200, headers: { "content-type": "image/jpeg" } });
		};
		const simpleCrawl = initSimple({ fetch: fakeFetch });

		const result = await simpleCrawl({ url: "https://example.com", fetchThumbnail: true });

		assertFetched(result);
		expect(result.thumbnailUrl).toBe("https://dead.example.com/og.jpg");
		expect(result.thumbnailImage).toEqual({
			body: imageBytes,
			contentType: "image/jpeg",
			url: "https://cdn.example.com/body.jpg",
			extension: ".jpg",
		});
	});

	it("derives extension from URL pathname when content-type is not in the known MIME map", async () => {
		const htmlWithThumb = `<html><head><meta property="og:image" content="https://cdn.example.com/photo.tiff"></head></html>`;
		let call = 0;
		const fakeFetch: typeof fetch = async () => {
			call += 1;
			if (call === 1) return new Response(htmlWithThumb, { status: 200, headers: { "content-type": "text/html" } });
			return new Response(imageBytes, { status: 200, headers: { "content-type": "image/tiff" } });
		};
		const simpleCrawl = initSimple({ fetch: fakeFetch });

		const result = await simpleCrawl({ url: "https://example.com", fetchThumbnail: true });

		assertFetched(result);
		expect(result.thumbnailImage?.extension).toBe(".tiff");
	});

	it("uses .bin extension when content-type is unknown and URL has no file extension", async () => {
		const htmlWithThumb = `<html><head><meta property="og:image" content="https://cdn.example.com/image"></head></html>`;
		let call = 0;
		const fakeFetch: typeof fetch = async () => {
			call += 1;
			if (call === 1) return new Response(htmlWithThumb, { status: 200, headers: { "content-type": "text/html" } });
			return new Response(imageBytes, { status: 200, headers: { "content-type": "image/x-custom" } });
		};
		const simpleCrawl = initSimple({ fetch: fakeFetch });

		const result = await simpleCrawl({ url: "https://example.com", fetchThumbnail: true });

		assertFetched(result);
		expect(result.thumbnailImage?.extension).toBe(".bin");
	});
});

describe("initSimpleCrawl — thumbnailUrl extraction (tested through simpleCrawl)", () => {
	it("extracts og:image as thumbnailUrl", async () => {
		const fakeFetch: typeof fetch = async () => new Response(
			'<html><head><meta property="og:image" content="https://example.com/og.jpg"></head></html>',
			{ status: 200, headers: { "content-type": "text/html" } },
		);
		const simpleCrawl = initSimple({ fetch: fakeFetch });

		const result = await simpleCrawl({ url: "https://example.com" });

		assertFetched(result);
		expect(result.thumbnailUrl).toBe("https://example.com/og.jpg");
	});

	it("extracts twitter:image when og:image is absent", async () => {
		const fakeFetch: typeof fetch = async () => new Response(
			'<html><head><meta name="twitter:image" content="https://example.com/tw.jpg"></head></html>',
			{ status: 200, headers: { "content-type": "text/html" } },
		);
		const simpleCrawl = initSimple({ fetch: fakeFetch });

		const result = await simpleCrawl({ url: "https://example.com" });

		assertFetched(result);
		expect(result.thumbnailUrl).toBe("https://example.com/tw.jpg");
	});

	it("prefers og:image over twitter:image", async () => {
		const fakeFetch: typeof fetch = async () => new Response(
			'<html><head><meta property="og:image" content="https://example.com/og.jpg"><meta name="twitter:image" content="https://example.com/tw.jpg"></head></html>',
			{ status: 200, headers: { "content-type": "text/html" } },
		);
		const simpleCrawl = initSimple({ fetch: fakeFetch });

		const result = await simpleCrawl({ url: "https://example.com" });

		assertFetched(result);
		expect(result.thumbnailUrl).toBe("https://example.com/og.jpg");
	});

	it("falls back to first body img when no meta tags exist", async () => {
		const fakeFetch: typeof fetch = async () => new Response(
			'<html><body><img src="https://example.com/photo.jpg"><img src="https://example.com/second.jpg"></body></html>',
			{ status: 200, headers: { "content-type": "text/html" } },
		);
		const simpleCrawl = initSimple({ fetch: fakeFetch });

		const result = await simpleCrawl({ url: "https://example.com" });

		assertFetched(result);
		expect(result.thumbnailUrl).toBe("https://example.com/photo.jpg");
	});

	it("returns thumbnailUrl undefined when no images exist", async () => {
		const fakeFetch: typeof fetch = async () => new Response(
			"<html><head></head><body><p>No images</p></body></html>",
			{ status: 200, headers: { "content-type": "text/html" } },
		);
		const simpleCrawl = initSimple({ fetch: fakeFetch });

		const result = await simpleCrawl({ url: "https://example.com" });

		assertFetched(result);
		expect(result.thumbnailUrl).toBeUndefined();
	});

	it("rejects data: and javascript: URIs", async () => {
		const fakeFetch: typeof fetch = async () => new Response(
			'<html><head><meta property="og:image" content="data:image/png;base64,abc"></head><body><img src="javascript:alert(1)"></body></html>',
			{ status: 200, headers: { "content-type": "text/html" } },
		);
		const simpleCrawl = initSimple({ fetch: fakeFetch });

		const result = await simpleCrawl({ url: "https://example.com" });

		assertFetched(result);
		expect(result.thumbnailUrl).toBeUndefined();
	});

	it("resolves relative og:image using the article URL as base", async () => {
		const fakeFetch: typeof fetch = async () => new Response(
			'<html><head><meta property="og:image" content="/images/og.jpg"></head></html>',
			{ status: 200, headers: { "content-type": "text/html" } },
		);
		const simpleCrawl = initSimple({ fetch: fakeFetch });

		const result = await simpleCrawl({ url: "https://example.com/post" });

		assertFetched(result);
		expect(result.thumbnailUrl).toBe("https://example.com/images/og.jpg");
	});

	function assertFetched(result: CrawlArticleResult): asserts result is CrawlArticleResult & { status: "fetched" } {
		assert(result.status === "fetched", `Expected 'fetched', got '${result.status}'`);
	}
});

describe("initSimpleCrawl — non-HTML content bail (no content-type-specific knowledge)", () => {
	it("returns unsupported with the content-type when Content-Type is application/pdf", async () => {
		const fakeFetch: typeof fetch = async () =>
			new Response(Buffer.from("%PDF-1.4\n"), { status: 200, headers: { "content-type": "application/pdf" } });
		const simpleCrawl = initSimple({ fetch: fakeFetch });

		const result = await simpleCrawl({ url: "https://example.com/doc.pdf" });

		expect(result).toEqual({ status: "unsupported", reason: "non-html content type: application/pdf" });
	});

	it("returns unsupported with the content-type for application/octet-stream without sniffing the body", async () => {
		const pdfMagicBuffer = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(64, 0x20)]);
		const fakeFetch: typeof fetch = async () =>
			new Response(pdfMagicBuffer, { status: 200, headers: { "content-type": "application/octet-stream" } });
		const simpleCrawl = initSimple({ fetch: fakeFetch });

		const result = await simpleCrawl({ url: "https://example.com/noheader" });

		expect(result).toEqual({ status: "unsupported", reason: "non-html content type: application/octet-stream" });
	});

	it("returns unsupported with empty content-type when the header is missing", async () => {
		const fakeFetch: typeof fetch = async () => new Response(Buffer.from("%PDF-1.4\n"), { status: 200, headers: {} });
		const simpleCrawl = initSimple({ fetch: fakeFetch });

		const result = await simpleCrawl({ url: "https://example.com/silent" });

		expect(result).toEqual({ status: "unsupported", reason: "non-html content type: " });
	});
});

describe("initComprehensiveCrawl — PDF extraction", () => {
	const pdfMagicBuffer = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(64, 0x20)]);

	function pdfResponse(body: Buffer, headers: Record<string, string> = { "content-type": "application/pdf" }): Response {
		return new Response(body, { status: 200, headers });
	}

	it("invokes extractPdf when Content-Type is application/pdf and returns synthetic HTML on success", async () => {
		let capturedExtract: { buffer: Buffer; url: string } | undefined;
		const extractPdf: ExtractPdf = async (params) => {
			capturedExtract = params;
			return { kind: "fetched", html: "<html><body><h1>Title</h1><p>Body</p></body></html>", title: "Title" };
		};
		const fakeFetch: typeof fetch = async () => pdfResponse(pdfMagicBuffer, {
			"content-type": "application/pdf",
			etag: '"pdf-123"',
			"last-modified": "Wed, 21 Oct 2025 07:28:00 GMT",
		});
		const comprehensiveCrawl = initComprehensive({ fetch: fakeFetch, extractPdf });

		const result = await comprehensiveCrawl({ url: "https://example.com/doc.pdf" });

		expect(result).toEqual({
			status: "fetched",
			html: "<html><body><h1>Title</h1><p>Body</p></body></html>",
			etag: '"pdf-123"',
			lastModified: "Wed, 21 Oct 2025 07:28:00 GMT",
		});
		expect(capturedExtract?.url).toBe("https://example.com/doc.pdf");
		expect(capturedExtract?.buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
	});

	it("invokes extractPdf for the application/x-pdf alias", async () => {
		const extractPdf = jest.fn<ReturnType<ExtractPdf>, Parameters<ExtractPdf>>().mockResolvedValue({
			kind: "fetched",
			html: "<html><body><p>ok</p></body></html>",
			title: "ok",
		});
		const fakeFetch: typeof fetch = async () => pdfResponse(pdfMagicBuffer, { "content-type": "application/x-pdf" });
		const comprehensiveCrawl = initComprehensive({ fetch: fakeFetch, extractPdf });

		const result = await comprehensiveCrawl({ url: "https://example.com/legacy.pdf" });

		expect(result.status).toBe("fetched");
		expect(extractPdf).toHaveBeenCalledTimes(1);
	});

	it("invokes extractPdf via magic-byte sniffing when Content-Type is octet-stream", async () => {
		const extractPdf = jest.fn<ReturnType<ExtractPdf>, Parameters<ExtractPdf>>().mockResolvedValue({
			kind: "fetched",
			html: "<html><body><p>sniffed</p></body></html>",
			title: "sniffed",
		});
		const fakeFetch: typeof fetch = async () => pdfResponse(pdfMagicBuffer, { "content-type": "application/octet-stream" });
		const comprehensiveCrawl = initComprehensive({ fetch: fakeFetch, extractPdf });

		const result = await comprehensiveCrawl({ url: "https://example.com/noheader" });

		expect(result.status).toBe("fetched");
		expect(extractPdf).toHaveBeenCalledTimes(1);
	});

	it("returns status 'unsupported' with the extractor reason when extractPdf reports failure", async () => {
		const extractPdf: ExtractPdf = async () => ({ kind: "failed", reason: PDF_EXTRACT_FAILURE_REASON });
		const fakeFetch: typeof fetch = async () => pdfResponse(pdfMagicBuffer);
		const logError = jest.fn();
		const comprehensiveCrawl = initComprehensive({ fetch: fakeFetch, extractPdf, logError });

		const result = await comprehensiveCrawl({ url: "https://example.com/scan.pdf" });

		expect(result).toEqual({
			status: "unsupported",
			reason: `pdf extraction failed: ${PDF_EXTRACT_FAILURE_REASON}`,
		});
		expect(logError).toHaveBeenCalledWith(
			`[CrawlArticle] PDF extraction failed for https://example.com/scan.pdf: ${PDF_EXTRACT_FAILURE_REASON}`,
		);
	});

	it("returns status 'unsupported' with the byte count when PDF body exceeds 25 MiB", async () => {
		const oversize = Buffer.concat([Buffer.from("%PDF-1.4"), Buffer.alloc(25 * 1024 * 1024 + 1, 0x20)]);
		const extractPdf = jest.fn<ReturnType<ExtractPdf>, Parameters<ExtractPdf>>();
		const fakeFetch: typeof fetch = async () => pdfResponse(oversize);
		const logError = jest.fn();
		const comprehensiveCrawl = initComprehensive({ fetch: fakeFetch, extractPdf, logError });

		const result = await comprehensiveCrawl({ url: "https://example.com/huge.pdf" });

		expect(result).toEqual({
			status: "unsupported",
			reason: `pdf body too large: ${oversize.length} bytes`,
		});
		expect(extractPdf).not.toHaveBeenCalled();
		expect(logError).toHaveBeenCalledWith(
			`[CrawlArticle] PDF body too large (${oversize.length} bytes) for https://example.com/huge.pdf`,
		);
	});

	it("returns status 'unsupported' with a 'non-pdf' reason when invoked on non-pdf content (defensive — orchestrator should not invoke this for non-pdf urls)", async () => {
		const extractPdf = jest.fn<ReturnType<ExtractPdf>, Parameters<ExtractPdf>>();
		const fakeFetch: typeof fetch = async () =>
			new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });
		const logError = jest.fn();
		const comprehensiveCrawl = initComprehensive({ fetch: fakeFetch, extractPdf, logError });

		const result = await comprehensiveCrawl({ url: "https://example.com/article" });

		expect(result).toEqual({ status: "unsupported", reason: "non-pdf content type: text/html" });
		expect(extractPdf).not.toHaveBeenCalled();
		expect(logError).toHaveBeenCalledWith('[CrawlArticle] Comprehensive crawl invoked on non-pdf "text/html" for https://example.com/article');
	});

	it("returns 'not-modified' on 304", async () => {
		const fakeFetch: typeof fetch = async () => new Response(null, { status: 304 });
		const comprehensiveCrawl = initComprehensive({ fetch: fakeFetch });

		const result = await comprehensiveCrawl({ url: "https://example.com/doc.pdf", etag: '"abc"' });

		expect(result).toEqual({ status: "not-modified" });
	});

	it("returns 'failed' on non-ok response", async () => {
		const fakeFetch: typeof fetch = async () => new Response(null, { status: 500 });
		const logError = jest.fn();
		const comprehensiveCrawl = initComprehensive({ fetch: fakeFetch, logError });

		const result = await comprehensiveCrawl({ url: "https://example.com/doc.pdf" });

		expect(result).toEqual({ status: "failed" });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] HTTP 500 for https://example.com/doc.pdf");
	});

	it("returns 'failed' when fetch throws", async () => {
		const networkError = Object.assign(new Error("boom"), { code: "ECONNREFUSED" });
		const fakeFetch: typeof fetch = async () => { throw networkError; };
		const logError = jest.fn();
		const comprehensiveCrawl = initComprehensive({ fetch: fakeFetch, logError });

		const result = await comprehensiveCrawl({ url: "https://example.com/doc.pdf" });

		expect(result).toEqual({ status: "failed" });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] Network error for https://example.com/doc.pdf", networkError);
	});
});

describe("initCrawlArticle — composed (simple ▸ comprehensive)", () => {
	const pdfMagicBuffer = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(64, 0x20)]);

	it("returns the simple-path 'fetched' result without invoking the extractor on HTML responses", async () => {
		const extractPdf = jest.fn<ReturnType<ExtractPdf>, Parameters<ExtractPdf>>();
		const fakeFetch: typeof fetch = async () =>
			new Response("<html>Hi</html>", { status: 200, headers: { "content-type": "text/html" } });
		const crawlArticle = initCrawl({ fetch: fakeFetch, extractPdf });

		const result = await crawlArticle({ url: "https://example.com/article" });

		expect(result.status).toBe("fetched");
		expect(extractPdf).not.toHaveBeenCalled();
	});

	it("falls through to comprehensive when simple returns unsupported and surfaces the extracted html on success", async () => {
		const extractPdf: ExtractPdf = async () => ({
			kind: "fetched",
			html: "<html><body><p>PDF body</p></body></html>",
			title: "doc",
		});
		const fakeFetch: typeof fetch = async () =>
			new Response(pdfMagicBuffer, { status: 200, headers: { "content-type": "application/pdf" } });
		const crawlArticle = initCrawl({ fetch: fakeFetch, extractPdf });

		const result = await crawlArticle({ url: "https://example.com/doc.pdf" });

		expect(result).toEqual({
			status: "fetched",
			html: "<html><body><p>PDF body</p></body></html>",
			etag: undefined,
			lastModified: undefined,
		});
	});

	it("falls through to comprehensive for any unsupported content type — comprehensive decides whether it can handle it", async () => {
		const extractPdf = jest.fn<ReturnType<ExtractPdf>, Parameters<ExtractPdf>>();
		const fakeFetch: typeof fetch = async () =>
			new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
		const logError = jest.fn();
		const crawlArticle = initCrawl({ fetch: fakeFetch, extractPdf, logError });

		const result = await crawlArticle({ url: "https://example.com/api" });

		expect(result).toEqual({ status: "unsupported", reason: "non-pdf content type: application/json" });
		expect(extractPdf).not.toHaveBeenCalled();
	});
});
