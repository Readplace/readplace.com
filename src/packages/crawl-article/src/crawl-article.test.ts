import assert from "node:assert";
import { initCrawlArticle, DEFAULT_CRAWL_HEADERS } from "./crawl-article";
import type { CrawlArticleResult } from "./crawl-article.types";
import { initCrawlFetch } from "./crawl-fetch";
import type { fetchCurl } from "./curl-fetch";

const noopLogError = () => {};

// Default stub: never reaches real network in unit tests. Tests that want to
// verify fallback behaviour pass a curl impl explicitly via overrides.fetchCurl.
const stubFetchCurl: typeof fetchCurl = async () => {
	throw new Error("stub fetchCurl: not invoked");
};

function initCrawl(overrides?: {
	fetch?: typeof fetch;
	logError?: (message: string, error?: Error) => void;
	fetchCurl?: typeof fetchCurl;
}) {
	const defaultFetch: typeof fetch = async () =>
		new Response("<html></html>", {
			status: 200,
			headers: { "content-type": "text/html" },
		});
	const crawlFetch = initCrawlFetch({
		fetch: overrides?.fetch ?? defaultFetch,
		defaultHeaders: { ...DEFAULT_CRAWL_HEADERS },
		fetchCurl: overrides?.fetchCurl ?? stubFetchCurl,
	});
	return initCrawlArticle({
		crawlFetch,
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

describe("initCrawlArticle — regular first-save fetch", () => {
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
		const crawlArticle = initCrawl({ fetch: fakeFetch });

		const result = await crawlArticle({ url: "https://example.com" });

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
		const crawlArticle = initCrawl({ fetch: fakeFetch });

		const result = await crawlArticle({ url: "https://example.com" });

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
		const crawlArticle = initCrawl({ fetch: fakeFetch });

		await crawlArticle({ url: "https://example.com" });

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
		const crawlArticle = initCrawl({ fetch: fakeFetch });

		const result = await crawlArticle({ url: "https://example.com" });

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
		const crawlArticle = initCrawl({ fetch: fakeFetch });

		await crawlArticle({ url: "https://example.com/article" });

		expect(capturedInput).toBe("https://example.com/article");
	});
});

describe("initCrawlArticle — TTL refresh with conditional headers", () => {
	it("returns status 'not-modified' on 304 response", async () => {
		const fakeFetch: typeof fetch = async () => new Response(null, { status: 304 });
		const crawlArticle = initCrawl({ fetch: fakeFetch });

		const result = await crawlArticle({
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
		const crawlArticle = initCrawl({ fetch: fakeFetch });

		const result = await crawlArticle({
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
		const crawlArticle = initCrawl({ fetch: fakeFetch });

		await crawlArticle({ url: "https://example.com", etag: '"abc123"' });

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
		const crawlArticle = initCrawl({ fetch: fakeFetch });

		await crawlArticle({
			url: "https://example.com",
			lastModified: "Wed, 21 Oct 2025 07:28:00 GMT",
		});

		const headers = plainHeaders(capturedInit);
		expect(headers["if-modified-since"]).toBe("Wed, 21 Oct 2025 07:28:00 GMT");
		expect(headers["user-agent"]).toBeTruthy();
	});
});

describe("initCrawlArticle — X/Twitter oembed fallback", () => {
	it("fetches tweet content via oembed API for x.com URLs", async () => {
		const fakeFetch: typeof fetch = async (input) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			if (url.includes("publish.twitter.com/oembed")) {
				return new Response(JSON.stringify({
					author_name: "Elon Musk",
					html: '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Test tweet</p></blockquote>\n',
				}), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			return new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });
		};
		const crawlArticle = initCrawl({ fetch: fakeFetch });

		const result = await crawlArticle({ url: "https://x.com/elonmusk/status/1519480761749016577" });

		expect(result).toEqual({
			status: "fetched",
			html: '<html><head><title>Elon Musk</title></head><body><blockquote class="twitter-tweet"><p lang="en" dir="ltr">Test tweet</p></blockquote>\n</body></html>',
		});
	});

	it("fetches tweet content via oembed API for twitter.com URLs", async () => {
		const fakeFetch: typeof fetch = async () =>
			new Response(JSON.stringify({
				author_name: "User",
				html: "<blockquote>Tweet</blockquote>\n",
			}), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		const crawlArticle = initCrawl({ fetch: fakeFetch });

		const result = await crawlArticle({ url: "https://twitter.com/user/status/123" });

		expect(result.status).toBe("fetched");
	});

	it("returns 'failed' when oembed API returns non-ok status", async () => {
		const fakeFetch: typeof fetch = async () => new Response(null, { status: 404 });
		const logError = jest.fn();
		const crawlArticle = initCrawl({ fetch: fakeFetch, logError });

		const result = await crawlArticle({ url: "https://x.com/user/status/123" });

		expect(result).toEqual({ status: "failed" });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] oembed HTTP 404 for https://x.com/user/status/123");
	});

	it("returns 'failed' when oembed API throws a network error", async () => {
		const networkError = new Error("timeout");
		const fakeFetch: typeof fetch = async () => { throw networkError; };
		const curlError = new Error("curl also failed");
		const stubCurl: typeof fetchCurl = async () => { throw curlError; };
		const logError = jest.fn();
		const crawlArticle = initCrawl({ fetch: fakeFetch, fetchCurl: stubCurl, logError });

		const result = await crawlArticle({ url: "https://x.com/user/status/123" });

		expect(result).toEqual({ status: "failed" });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] oembed error for https://x.com/user/status/123", curlError);
	});

	it("encodes the tweet URL in the oembed request", async () => {
		let capturedUrl = "";
		const fakeFetch: typeof fetch = async (input) => {
			capturedUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			return new Response(JSON.stringify({ author_name: "", html: "" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		};
		const crawlArticle = initCrawl({ fetch: fakeFetch });

		await crawlArticle({ url: "https://x.com/user/status/123?ref=test" });

		expect(capturedUrl).toBe("https://publish.twitter.com/oembed?url=https%3A%2F%2Fx.com%2Fuser%2Fstatus%2F123%3Fref%3Dtest");
	});
});

describe("initCrawlArticle — failure modes", () => {
	it("returns status 'failed' and logs HTTP status when response is not ok and not 304", async () => {
		const fakeFetch: typeof fetch = async () => new Response(null, { status: 403 });
		const logError = jest.fn();
		const crawlArticle = initCrawl({ fetch: fakeFetch, logError });

		const result = await crawlArticle({ url: "https://example.com" });

		expect(result).toEqual({ status: "failed" });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] HTTP 403 for https://example.com");
	});

	it("returns status 'unsupported' with the content-type reason when the origin serves a non-html body (PDF, JSON, …)", async () => {
		const fakeFetch: typeof fetch = async () =>
			new Response("{}", {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		const logError = jest.fn();
		const crawlArticle = initCrawl({ fetch: fakeFetch, logError });

		const result = await crawlArticle({ url: "https://example.com" });

		expect(result).toEqual({
			status: "unsupported",
			reason: "non-html content type: application/json",
		});
		expect(logError).toHaveBeenCalledWith('[CrawlArticle] Unexpected Content-Type "application/json" for https://example.com');
	});

	it("returns status 'unsupported' with an empty content-type reason when the header is missing", async () => {
		// Buffer body bypasses Response's auto-assigned text/plain Content-Type, so headers.get returns null
		const fakeFetch: typeof fetch = async () =>
			new Response(Buffer.from("<html>Content</html>"), { status: 200, headers: {} });
		const logError = jest.fn();
		const crawlArticle = initCrawl({ fetch: fakeFetch, logError });

		const result = await crawlArticle({ url: "https://example.com" });

		expect(result).toEqual({ status: "unsupported", reason: "non-html content type: " });
		expect(logError).toHaveBeenCalledWith('[CrawlArticle] Unexpected Content-Type "" for https://example.com');
	});

	it("returns status 'failed' and logs with the Error instance when fetch throws a clear network error (curl fallback skipped)", async () => {
		const networkError = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
		const fakeFetch: typeof fetch = async () => { throw networkError; };
		const logError = jest.fn();
		const crawlArticle = initCrawl({ fetch: fakeFetch, logError });

		const result = await crawlArticle({ url: "https://example.com" });

		expect(result).toEqual({ status: "failed" });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] Network error for https://example.com", networkError);
	});

	it("returns status 'failed' when fetch throws a transient error and curl fallback also fails", async () => {
		const fakeFetch: typeof fetch = async () => { throw new Error("network down"); };
		const curlError = new Error("curl also failed");
		const fakeCurl: typeof fetchCurl = async () => { throw curlError; };
		const logError = jest.fn();
		const crawlArticle = initCrawl({ fetch: fakeFetch, fetchCurl: fakeCurl, logError });

		const result = await crawlArticle({ url: "https://example.com" });

		expect(result).toEqual({ status: "failed" });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] Network error for https://example.com", curlError);
	});

	it("returns status 'failed' and logs undefined when fetch throws a non-Error value and curl fallback also fails with a non-Error", async () => {
		const fakeFetch: typeof fetch = async () => { throw "string error"; };
		const fakeCurl: typeof fetchCurl = async () => { throw "string error from curl"; };
		const logError = jest.fn();
		const crawlArticle = initCrawl({ fetch: fakeFetch, fetchCurl: fakeCurl, logError });

		const result = await crawlArticle({ url: "https://example.com" });

		expect(result).toEqual({ status: "failed" });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] Network error for https://example.com", undefined);
	});
});

describe("initCrawlArticle — thumbnail fetch (fetchThumbnail opt-in)", () => {
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
		const crawlArticle = initCrawl({ fetch: fakeFetch });

		const result = await crawlArticle({ url: "https://example.com" });

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
		const crawlArticle = initCrawl({ fetch: fakeFetch });

		await crawlArticle({ url: "https://example.com", fetchThumbnail: true });

		const headers = plainHeaders(thumbnailInit);
		expect(headers.accept).toBe("image/*,*/*;q=0.8");
	});

	it("returns thumbnailImage undefined when the article has no thumbnail URL", async () => {
		const fakeFetch: typeof fetch = async () =>
			new Response("<html><head><title>No image</title></head><body></body></html>", {
				status: 200,
				headers: { "content-type": "text/html" },
			});
		const crawlArticle = initCrawl({ fetch: fakeFetch });

		const result = await crawlArticle({ url: "https://example.com", fetchThumbnail: true });

		assertFetched(result);
		expect(result.thumbnailImage).toBeUndefined();
	});

	it("logs and returns thumbnailImage undefined when the thumbnail HTTP request fails", async () => {
		const fakeFetch = articleThenImageFetch(new Response(null, { status: 403 }));
		const logError = jest.fn();
		const crawlArticle = initCrawl({ fetch: fakeFetch, logError });

		const result = await crawlArticle({ url: "https://example.com", fetchThumbnail: true });

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
		const crawlArticle = initCrawl({ fetch: fakeFetch, logError });

		const result = await crawlArticle({ url: "https://example.com", fetchThumbnail: true });

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
		const crawlArticle = initCrawl({ fetch: fakeFetch, logError });

		const result = await crawlArticle({ url: "https://example.com", fetchThumbnail: true });

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
		const crawlArticle = initCrawl({ fetch: fakeFetch, logError });

		const result = await crawlArticle({ url: "https://example.com", fetchThumbnail: true });

		assertFetched(result);
		expect(result.thumbnailImage).toBeUndefined();
		expect(logError).toHaveBeenCalledWith(`[CrawlArticle] Thumbnail too large (${oversizedBody.length} bytes) for https://cdn.example.com/thumb.jpg`);
	});

	it("logs and returns thumbnailImage undefined when the thumbnail fetch throws a clear network error (curl fallback skipped)", async () => {
		const networkError = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
		const fakeFetch = articleThenImageFetch(() => { throw networkError; });
		const logError = jest.fn();
		const crawlArticle = initCrawl({ fetch: fakeFetch, logError });

		const result = await crawlArticle({ url: "https://example.com", fetchThumbnail: true });

		assertFetched(result);
		expect(result.thumbnailImage).toBeUndefined();
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] Thumbnail network error for https://cdn.example.com/thumb.jpg", networkError);
	});

	it("logs with undefined when the thumbnail fetch throws a non-Error value and curl fallback also fails with a non-Error", async () => {
		const fakeFetch = articleThenImageFetch(() => { throw "boom"; });
		const fakeCurl: typeof fetchCurl = async () => { throw "boom from curl"; };
		const logError = jest.fn();
		const crawlArticle = initCrawl({ fetch: fakeFetch, fetchCurl: fakeCurl, logError });

		const result = await crawlArticle({ url: "https://example.com", fetchThumbnail: true });

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
		const crawlArticle = initCrawl({ fetch: fakeFetch });

		const result = await crawlArticle({ url: "https://example.com", fetchThumbnail: true });

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
		const crawlArticle = initCrawl({ fetch: fakeFetch });

		const result = await crawlArticle({ url: "https://example.com", fetchThumbnail: true });

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
		const crawlArticle = initCrawl({ fetch: fakeFetch });

		const result = await crawlArticle({ url: "https://example.com", fetchThumbnail: true });

		assertFetched(result);
		expect(result.thumbnailImage?.extension).toBe(".bin");
	});
});

describe("initCrawlArticle — thumbnailUrl extraction (tested through crawlArticle)", () => {
	it("extracts og:image as thumbnailUrl", async () => {
		const fakeFetch: typeof fetch = async () => new Response(
			'<html><head><meta property="og:image" content="https://example.com/og.jpg"></head></html>',
			{ status: 200, headers: { "content-type": "text/html" } },
		);
		const crawlArticle = initCrawl({ fetch: fakeFetch });

		const result = await crawlArticle({ url: "https://example.com" });

		assertFetched(result);
		expect(result.thumbnailUrl).toBe("https://example.com/og.jpg");
	});

	it("extracts twitter:image when og:image is absent", async () => {
		const fakeFetch: typeof fetch = async () => new Response(
			'<html><head><meta name="twitter:image" content="https://example.com/tw.jpg"></head></html>',
			{ status: 200, headers: { "content-type": "text/html" } },
		);
		const crawlArticle = initCrawl({ fetch: fakeFetch });

		const result = await crawlArticle({ url: "https://example.com" });

		assertFetched(result);
		expect(result.thumbnailUrl).toBe("https://example.com/tw.jpg");
	});

	it("prefers og:image over twitter:image", async () => {
		const fakeFetch: typeof fetch = async () => new Response(
			'<html><head><meta property="og:image" content="https://example.com/og.jpg"><meta name="twitter:image" content="https://example.com/tw.jpg"></head></html>',
			{ status: 200, headers: { "content-type": "text/html" } },
		);
		const crawlArticle = initCrawl({ fetch: fakeFetch });

		const result = await crawlArticle({ url: "https://example.com" });

		assertFetched(result);
		expect(result.thumbnailUrl).toBe("https://example.com/og.jpg");
	});

	it("falls back to first body img when no meta tags exist", async () => {
		const fakeFetch: typeof fetch = async () => new Response(
			'<html><body><img src="https://example.com/photo.jpg"><img src="https://example.com/second.jpg"></body></html>',
			{ status: 200, headers: { "content-type": "text/html" } },
		);
		const crawlArticle = initCrawl({ fetch: fakeFetch });

		const result = await crawlArticle({ url: "https://example.com" });

		assertFetched(result);
		expect(result.thumbnailUrl).toBe("https://example.com/photo.jpg");
	});

	it("returns thumbnailUrl undefined when no images exist", async () => {
		const fakeFetch: typeof fetch = async () => new Response(
			"<html><head></head><body><p>No images</p></body></html>",
			{ status: 200, headers: { "content-type": "text/html" } },
		);
		const crawlArticle = initCrawl({ fetch: fakeFetch });

		const result = await crawlArticle({ url: "https://example.com" });

		assertFetched(result);
		expect(result.thumbnailUrl).toBeUndefined();
	});

	it("rejects data: and javascript: URIs", async () => {
		const fakeFetch: typeof fetch = async () => new Response(
			'<html><head><meta property="og:image" content="data:image/png;base64,abc"></head><body><img src="javascript:alert(1)"></body></html>',
			{ status: 200, headers: { "content-type": "text/html" } },
		);
		const crawlArticle = initCrawl({ fetch: fakeFetch });

		const result = await crawlArticle({ url: "https://example.com" });

		assertFetched(result);
		expect(result.thumbnailUrl).toBeUndefined();
	});

	it("resolves relative og:image using the article URL as base", async () => {
		const fakeFetch: typeof fetch = async () => new Response(
			'<html><head><meta property="og:image" content="/images/og.jpg"></head></html>',
			{ status: 200, headers: { "content-type": "text/html" } },
		);
		const crawlArticle = initCrawl({ fetch: fakeFetch });

		const result = await crawlArticle({ url: "https://example.com/post" });

		assertFetched(result);
		expect(result.thumbnailUrl).toBe("https://example.com/images/og.jpg");
	});

	function assertFetched(result: CrawlArticleResult): asserts result is CrawlArticleResult & { status: "fetched" } {
		assert(result.status === "fetched", `Expected 'fetched', got '${result.status}'`);
	}
});
