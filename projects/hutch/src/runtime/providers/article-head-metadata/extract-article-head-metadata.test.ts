import assert from "node:assert/strict";
import { type HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initExtractArticleHeadMetadata } from "./extract-article-head-metadata";

function buildHtmlResponse(html: string): Response {
	return new Response(html, {
		status: 200,
		headers: { "content-type": "text/html; charset=utf-8" },
	});
}

function captureWarnings(): { logger: HutchLogger; warnings: unknown[] } {
	const warnings: unknown[] = [];
	const logger: HutchLogger = {
		...noopLogger,
		warn: (...args: unknown[]) => {
			warnings.push(args[0]);
		},
	};
	return { logger, warnings };
}

describe("initExtractArticleHeadMetadata", () => {
	describe("success cases", () => {
		it("extracts og:image, og:title, og:description, og:site_name", async () => {
			const fetch: typeof globalThis.fetch = async () =>
				buildHtmlResponse(
					`<!doctype html><html><head>
						<meta property="og:image" content="https://cdn.example.com/hero.jpg">
						<meta property="og:title" content="A Real Title">
						<meta property="og:description" content="A real description.">
						<meta property="og:site_name" content="Example Site">
					</head><body></body></html>`,
				);
			const { extractArticleHeadMetadata } = initExtractArticleHeadMetadata({
				fetch,
				logger: noopLogger,
			});

			const result = await extractArticleHeadMetadata({
				articleUrl: "https://example.com/article",
			});

			assert.deepEqual(result, {
				imageUrl: "https://cdn.example.com/hero.jpg",
				title: "A Real Title",
				excerpt: "A real description.",
				siteName: "Example Site",
			});
		});

		it("resolves a relative og:image against the article URL", async () => {
			const fetch: typeof globalThis.fetch = async () =>
				buildHtmlResponse(
					`<!doctype html><html><head>
						<meta property="og:image" content="/static/hero.jpg">
						<meta property="og:title" content="Relative">
					</head></html>`,
				);
			const { extractArticleHeadMetadata } = initExtractArticleHeadMetadata({
				fetch,
				logger: noopLogger,
			});

			const result = await extractArticleHeadMetadata({
				articleUrl: "https://example.com/section/article",
			});

			assert.equal(result.imageUrl, "https://example.com/static/hero.jpg");
		});

		it("falls back to <title> and <meta name=description> when og:* are absent", async () => {
			const fetch: typeof globalThis.fetch = async () =>
				buildHtmlResponse(
					`<!doctype html><html><head>
						<title>Plain Title</title>
						<meta name="description" content="Plain description.">
					</head></html>`,
				);
			const { extractArticleHeadMetadata } = initExtractArticleHeadMetadata({
				fetch,
				logger: noopLogger,
			});

			const result = await extractArticleHeadMetadata({
				articleUrl: "https://example.com/post",
			});

			assert.equal(result.title, "Plain Title");
			assert.equal(result.excerpt, "Plain description.");
			assert.equal(result.imageUrl, undefined);
			assert.equal(result.siteName, undefined);
		});

		it("falls back to twitter:image when og:image is absent", async () => {
			const fetch: typeof globalThis.fetch = async () =>
				buildHtmlResponse(
					`<!doctype html><html><head>
						<meta name="twitter:image" content="https://cdn.example.com/twitter.jpg">
					</head></html>`,
				);
			const { extractArticleHeadMetadata } = initExtractArticleHeadMetadata({
				fetch,
				logger: noopLogger,
			});

			const result = await extractArticleHeadMetadata({
				articleUrl: "https://example.com/post",
			});

			assert.equal(result.imageUrl, "https://cdn.example.com/twitter.jpg");
		});

		it("returns empty object when the document has no relevant meta tags", async () => {
			const fetch: typeof globalThis.fetch = async () =>
				buildHtmlResponse(`<!doctype html><html><head></head></html>`);
			const { extractArticleHeadMetadata } = initExtractArticleHeadMetadata({
				fetch,
				logger: noopLogger,
			});

			const result = await extractArticleHeadMetadata({
				articleUrl: "https://example.com/post",
			});

			assert.deepEqual(result, {});
		});

		it("ignores whitespace-only meta content", async () => {
			const fetch: typeof globalThis.fetch = async () =>
				buildHtmlResponse(
					`<!doctype html><html><head>
						<meta property="og:title" content="   ">
						<title>Real Title</title>
					</head></html>`,
				);
			const { extractArticleHeadMetadata } = initExtractArticleHeadMetadata({
				fetch,
				logger: noopLogger,
			});

			const result = await extractArticleHeadMetadata({
				articleUrl: "https://example.com/post",
			});

			assert.equal(result.title, "Real Title");
		});

		it("drops a malformed og:image without losing other extracted fields", async () => {
			const fetch: typeof globalThis.fetch = async () =>
				buildHtmlResponse(
					`<!doctype html><html><head>
						<meta property="og:image" content="http://example.com:abc">
						<meta property="og:title" content="OK Title">
					</head></html>`,
				);
			const { extractArticleHeadMetadata } = initExtractArticleHeadMetadata({
				fetch,
				logger: noopLogger,
			});

			const result = await extractArticleHeadMetadata({
				articleUrl: "https://example.com/post",
			});

			assert.equal(result.imageUrl, undefined);
			assert.equal(result.title, "OK Title");
		});

		it("truncates an oversized body before parsing", async () => {
			const padding = "<p>".repeat(200_000);
			const html = `<!doctype html><html><head><meta property="og:title" content="Truncated"></head><body>${padding}</body></html>`;
			const fetch: typeof globalThis.fetch = async () => buildHtmlResponse(html);
			const { extractArticleHeadMetadata } = initExtractArticleHeadMetadata({
				fetch,
				logger: noopLogger,
			});

			const result = await extractArticleHeadMetadata({
				articleUrl: "https://example.com/post",
			});

			assert.equal(result.title, "Truncated");
		});
	});

	describe("failure cases", () => {
		it("returns {} and warns on a non-OK HTTP response", async () => {
			const fetch: typeof globalThis.fetch = async () =>
				new Response("server error", { status: 500 });
			const { logger, warnings } = captureWarnings();
			const { extractArticleHeadMetadata } = initExtractArticleHeadMetadata({
				fetch,
				logger,
			});

			const result = await extractArticleHeadMetadata({
				articleUrl: "https://example.com/post",
			});

			assert.deepEqual(result, {});
			assert.equal(warnings.length, 1);
			assert.deepEqual(warnings[0], {
				at: "extractArticleHeadMetadata.nonOk",
				articleUrl: "https://example.com/post",
				status: 500,
			});
		});

		it("returns {} and warns on a non-HTML content type", async () => {
			const fetch: typeof globalThis.fetch = async () =>
				new Response("%PDF-1.4", {
					status: 200,
					headers: { "content-type": "application/pdf" },
				});
			const { logger, warnings } = captureWarnings();
			const { extractArticleHeadMetadata } = initExtractArticleHeadMetadata({
				fetch,
				logger,
			});

			const result = await extractArticleHeadMetadata({
				articleUrl: "https://example.com/post.pdf",
			});

			assert.deepEqual(result, {});
			assert.equal(warnings.length, 1);
			assert.deepEqual(warnings[0], {
				at: "extractArticleHeadMetadata.nonHtml",
				articleUrl: "https://example.com/post.pdf",
				contentType: "application/pdf",
			});
		});

		it("returns {} and warns when content-type header is missing", async () => {
			const fetch: typeof globalThis.fetch = async () =>
				new Response("body", { status: 200, headers: {} });
			const { logger, warnings } = captureWarnings();
			const { extractArticleHeadMetadata } = initExtractArticleHeadMetadata({
				fetch,
				logger,
			});

			const result = await extractArticleHeadMetadata({
				articleUrl: "https://example.com/post",
			});

			assert.deepEqual(result, {});
			assert.equal(warnings.length, 1);
		});

		it("returns {} and warns when fetch rejects with a network error", async () => {
			const fetch: typeof globalThis.fetch = async () => {
				throw new TypeError("network failure");
			};
			const { logger, warnings } = captureWarnings();
			const { extractArticleHeadMetadata } = initExtractArticleHeadMetadata({
				fetch,
				logger,
			});

			const result = await extractArticleHeadMetadata({
				articleUrl: "https://example.com/post",
			});

			assert.deepEqual(result, {});
			assert.equal(warnings.length, 1);
			const warning = warnings[0];
			assert(typeof warning === "object" && warning !== null && "at" in warning && "error" in warning);
			assert.equal(warning.at, "extractArticleHeadMetadata.error");
			assert.equal(warning.error, "network failure");
		});

		it("returns {} and warns when fetch rejects with a non-Error value", async () => {
			const fetch: typeof globalThis.fetch = async () => {
				throw "string failure";
			};
			const { logger, warnings } = captureWarnings();
			const { extractArticleHeadMetadata } = initExtractArticleHeadMetadata({
				fetch,
				logger,
			});

			const result = await extractArticleHeadMetadata({
				articleUrl: "https://example.com/post",
			});

			assert.deepEqual(result, {});
			const warning = warnings[0];
			assert(typeof warning === "object" && warning !== null && "error" in warning);
			assert.equal(warning.error, "string failure");
		});

		it("aborts via the AbortController when fetch exceeds timeoutMs", async () => {
			const fetch: typeof globalThis.fetch = (_url, init) =>
				new Promise((_resolve, reject) => {
					const signal = init?.signal;
					assert(signal, "fetch must receive an AbortSignal");
					signal.addEventListener("abort", () => {
						reject(new DOMException("aborted", "AbortError"));
					});
				});
			const { logger, warnings } = captureWarnings();
			const { extractArticleHeadMetadata } = initExtractArticleHeadMetadata({
				fetch,
				logger,
				timeoutMs: 5,
			});

			const result = await extractArticleHeadMetadata({
				articleUrl: "https://example.com/post",
			});

			assert.deepEqual(result, {});
			assert.equal(warnings.length, 1);
			const warning = warnings[0];
			assert(typeof warning === "object" && warning !== null && "at" in warning);
			assert.equal(warning.at, "extractArticleHeadMetadata.error");
		});

		it("returns an empty object on malformed HTML without warning", async () => {
			const fetch: typeof globalThis.fetch = async () =>
				buildHtmlResponse("<<not html");
			const { logger, warnings } = captureWarnings();
			const { extractArticleHeadMetadata } = initExtractArticleHeadMetadata({
				fetch,
				logger,
			});

			const result = await extractArticleHeadMetadata({
				articleUrl: "https://example.com/post",
			});

			assert.deepEqual(result, {});
			assert.equal(warnings.length, 0);
		});
	});

	describe("request shape", () => {
		it("sends the configured user-agent and html accept header", async () => {
			const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
			const fetch: typeof globalThis.fetch = async (input, init) => {
				calls.push({ url: String(input), init });
				return buildHtmlResponse("<html><head></head></html>");
			};
			const { extractArticleHeadMetadata } = initExtractArticleHeadMetadata({
				fetch,
				logger: noopLogger,
				userAgent: "TestAgent/1.0",
			});

			await extractArticleHeadMetadata({
				articleUrl: "https://example.com/post",
			});

			assert.equal(calls.length, 1);
			assert.equal(calls[0].url, "https://example.com/post");
			const headers = calls[0].init?.headers;
			assert(typeof headers === "object" && headers !== null && !Array.isArray(headers) && "user-agent" in headers && "accept" in headers);
			assert.equal(headers["user-agent"], "TestAgent/1.0");
			assert.equal(headers.accept, "text/html,application/xhtml+xml;q=0.9");
		});
	});
});
