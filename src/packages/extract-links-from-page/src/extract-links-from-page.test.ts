import type { CrawlFetch } from "@packages/crawl-article";
import { initExtractLinksFromPageUrl } from "./extract-links-from-page";

function htmlResponse(html: string, opts?: { url?: string }): Response {
	const response = new Response(html, {
		status: 200,
		headers: { "content-type": "text/html; charset=utf-8" },
	});
	if (opts?.url) {
		Object.defineProperty(response, "url", { value: opts.url });
	}
	return response;
}

function fakeFetch(impl: (url: string, init?: { signal?: AbortSignal }) => Promise<Response>): CrawlFetch {
	return impl;
}

describe("initExtractLinksFromPageUrl", () => {
	it("returns OK with absolute hrefs preserved as-is", async () => {
		const html =
			'<html><body><a href="https://other.com/post-1">A</a><a href="https://other.com/post-2">B</a></body></html>';
		const extract = initExtractLinksFromPageUrl({
			crawlFetch: fakeFetch(async () => htmlResponse(html, { url: "https://news.example/issues/42" })),
		});

		const result = await extract("https://news.example/issues/42");

		expect(result.status).toBe("OK");
		if (result.status !== "OK") throw new Error("expected OK");
		expect(result.links.urls).toEqual([
			"https://other.com/post-1",
			"https://other.com/post-2",
		]);
	});

	it("resolves relative hrefs against response.url after redirects", async () => {
		const html = '<html><body><a href="/post">A</a></body></html>';
		const extract = initExtractLinksFromPageUrl({
			crawlFetch: fakeFetch(async () =>
				htmlResponse(html, { url: "https://redirect.example/issues/42" }),
			),
		});

		const result = await extract("https://news.example/issues/42");

		expect(result.status).toBe("OK");
		if (result.status !== "OK") throw new Error("expected OK");
		expect(result.links.urls).toEqual([]);
	});

	it("falls back to the requested URL when response.url is empty", async () => {
		const html = '<html><body><a href="https://elsewhere.com/post">A</a></body></html>';
		const extract = initExtractLinksFromPageUrl({
			crawlFetch: fakeFetch(async () => {
				const r = new Response(html, {
					status: 200,
					headers: { "content-type": "text/html" },
				});
				Object.defineProperty(r, "url", { value: "" });
				return r;
			}),
		});

		const result = await extract("https://news.example/issues/42");

		expect(result.status).toBe("OK");
		if (result.status !== "OK") throw new Error("expected OK");
		expect(result.links.urls).toEqual(["https://elsewhere.com/post"]);
	});

	it("drops same-host hrefs (newsletter chrome links)", async () => {
		const html = `
			<a href="/subscribe">Subscribe</a>
			<a href="https://news.example/footer">Footer</a>
			<a href="https://outside.com/article">Editorial</a>
		`;
		const extract = initExtractLinksFromPageUrl({
			crawlFetch: fakeFetch(async () => htmlResponse(html, { url: "https://news.example/issues/42" })),
		});

		const result = await extract("https://news.example/issues/42");

		expect(result.status).toBe("OK");
		if (result.status !== "OK") throw new Error("expected OK");
		expect(result.links.urls).toEqual(["https://outside.com/article"]);
	});

	it("drops the source URL itself if it appears in the page", async () => {
		const html =
			'<a href="https://news.example/issues/42">Permalink</a><a href="https://news.example/">Home</a><a href="https://outside.com/a">Article</a>';
		const extract = initExtractLinksFromPageUrl({
			crawlFetch: fakeFetch(async () => htmlResponse(html, { url: "https://news.example/issues/42" })),
		});

		const result = await extract("https://news.example/issues/42");

		expect(result.status).toBe("OK");
		if (result.status !== "OK") throw new Error("expected OK");
		expect(result.links.urls).toEqual(["https://outside.com/a"]);
	});

	it("drops mailto:, javascript:, tel:, data:, fragments, and empty hrefs", async () => {
		const html = `
			<a href="mailto:user@example.com">Mail</a>
			<a href="javascript:alert(1)">JS</a>
			<a href="tel:+15551234">Tel</a>
			<a href="data:text/html,x">Data</a>
			<a href="#section">Frag</a>
			<a href="">Empty</a>
			<a href="https://outside.com/keep">Keep</a>
		`;
		const extract = initExtractLinksFromPageUrl({
			crawlFetch: fakeFetch(async () => htmlResponse(html, { url: "https://news.example/issues/42" })),
		});

		const result = await extract("https://news.example/issues/42");

		expect(result.status).toBe("OK");
		if (result.status !== "OK") throw new Error("expected OK");
		expect(result.links.urls).toEqual(["https://outside.com/keep"]);
	});

	it("dedupes harvested hrefs via collectImportLinks", async () => {
		const html =
			'<a href="https://other.com/post">A</a><a href="https://OTHER.com/post">B</a><a href="https://other.com/post">C</a>';
		const extract = initExtractLinksFromPageUrl({
			crawlFetch: fakeFetch(async () => htmlResponse(html, { url: "https://news.example/issues/42" })),
		});

		const result = await extract("https://news.example/issues/42");

		expect(result.status).toBe("OK");
		if (result.status !== "OK") throw new Error("expected OK");
		expect(result.links.urls).toEqual(["https://other.com/post"]);
	});

	it("skips hrefs that fail URL parsing against the base", async () => {
		const html = '<a href="http://%ZZ"></a><a href="https://outside.com/ok"></a>';
		const extract = initExtractLinksFromPageUrl({
			crawlFetch: fakeFetch(async () => htmlResponse(html, { url: "https://news.example/issues/42" })),
		});

		const result = await extract("https://news.example/issues/42");

		expect(result.status).toBe("OK");
		if (result.status !== "OK") throw new Error("expected OK");
		expect(result.links.urls).toEqual(["https://outside.com/ok"]);
	});

	it("returns OK with an empty list when the page has no anchors", async () => {
		const extract = initExtractLinksFromPageUrl({
			crawlFetch: fakeFetch(async () =>
				htmlResponse("<html><body><p>just text</p></body></html>", {
					url: "https://news.example/issues/42",
				}),
			),
		});

		const result = await extract("https://news.example/issues/42");

		expect(result.status).toBe("OK");
		if (result.status !== "OK") throw new Error("expected OK");
		expect(result.links.urls).toEqual([]);
	});

	it("returns INVALID_URL for unsaveable inputs without fetching", async () => {
		let fetched = false;
		const extract = initExtractLinksFromPageUrl({
			crawlFetch: fakeFetch(async () => {
				fetched = true;
				return htmlResponse("");
			}),
		});

		const result = await extract("http://localhost/internal");

		expect(result.status).toBe("INVALID_URL");
		expect(fetched).toBe(false);
	});

	it("returns INVALID_URL for non-string-like rubbish", async () => {
		const extract = initExtractLinksFromPageUrl({
			crawlFetch: fakeFetch(async () => htmlResponse("")),
		});

		const result = await extract("not a url at all");

		expect(result.status).toBe("INVALID_URL");
	});

	it("maps an AbortError from the fetch timeout to FETCH_FAILED { reason: timeout }", async () => {
		const extract = initExtractLinksFromPageUrl({
			crawlFetch: fakeFetch(async (_url, init) => {
				return new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => {
						const err = new Error("aborted");
						err.name = "AbortError";
						reject(err);
					});
				});
			}),
		});

		jest.useFakeTimers();
		const promise = extract("https://news.example/issues/42");
		jest.advanceTimersByTime(10_001);
		const result = await promise;
		jest.useRealTimers();

		expect(result).toEqual({ status: "FETCH_FAILED", reason: "timeout" });
	});

	it("maps a network error to FETCH_FAILED { reason: network }", async () => {
		const extract = initExtractLinksFromPageUrl({
			crawlFetch: fakeFetch(async () => {
				throw new TypeError("dns failure");
			}),
		});

		const result = await extract("https://news.example/issues/42");

		expect(result).toEqual({ status: "FETCH_FAILED", reason: "network" });
	});

	it("maps a non-Error throw to FETCH_FAILED { reason: network }", async () => {
		const extract = initExtractLinksFromPageUrl({
			crawlFetch: fakeFetch(async () => {
				throw "boom";
			}),
		});

		const result = await extract("https://news.example/issues/42");

		expect(result).toEqual({ status: "FETCH_FAILED", reason: "network" });
	});

	it("maps an AbortError that fires before the timeout to FETCH_FAILED { reason: timeout }", async () => {
		const extract = initExtractLinksFromPageUrl({
			crawlFetch: fakeFetch(async () => {
				const err = new Error("aborted by caller");
				err.name = "AbortError";
				throw err;
			}),
		});

		const result = await extract("https://news.example/issues/42");

		expect(result).toEqual({ status: "FETCH_FAILED", reason: "timeout" });
	});

	it("maps !response.ok to FETCH_FAILED with the http status", async () => {
		const extract = initExtractLinksFromPageUrl({
			crawlFetch: fakeFetch(async () =>
				new Response("nope", {
					status: 404,
					headers: { "content-type": "text/html" },
				}),
			),
		});

		const result = await extract("https://news.example/issues/42");

		expect(result).toEqual({ status: "FETCH_FAILED", reason: "http", httpStatus: 404 });
	});

	it("rejects responses larger than 5 MiB", async () => {
		const body = "a".repeat(5 * 1024 * 1024 + 1);
		const extract = initExtractLinksFromPageUrl({
			crawlFetch: fakeFetch(async () => htmlResponse(body, { url: "https://news.example/issues/42" })),
		});

		const result = await extract("https://news.example/issues/42");

		expect(result).toEqual({ status: "FETCH_FAILED", reason: "too_large" });
	});

	it("returns UNSUPPORTED_CONTENT_TYPE for non-HTML responses", async () => {
		const extract = initExtractLinksFromPageUrl({
			crawlFetch: fakeFetch(async () =>
				new Response("%PDF-1.4", {
					status: 200,
					headers: { "content-type": "application/pdf" },
				}),
			),
		});

		const result = await extract("https://news.example/issues/42");

		expect(result).toEqual({ status: "UNSUPPORTED_CONTENT_TYPE", contentType: "application/pdf" });
	});

	it("treats a missing content-type as UNSUPPORTED_CONTENT_TYPE", async () => {
		const extract = initExtractLinksFromPageUrl({
			crawlFetch: fakeFetch(async () => {
				// Uint8Array body avoids the auto-applied text/plain content-type that
				// Response('string', …) sets. With no header, headers.get('content-type')
				// returns null, exercising the missing-content-type branch.
				return new Response(new Uint8Array([60, 104, 116, 109, 108, 62]), { status: 200 });
			}),
		});

		const result = await extract("https://news.example/issues/42");

		expect(result).toEqual({ status: "UNSUPPORTED_CONTENT_TYPE", contentType: "" });
	});

	it("accepts application/xhtml+xml as HTML", async () => {
		const html = '<a href="https://outside.com/x">X</a>';
		const extract = initExtractLinksFromPageUrl({
			crawlFetch: fakeFetch(async () =>
				new Response(html, {
					status: 200,
					headers: { "content-type": "application/xhtml+xml; charset=utf-8" },
				}),
			),
		});

		const result = await extract("https://news.example/issues/42");

		expect(result.status).toBe("OK");
		if (result.status !== "OK") throw new Error("expected OK");
		expect(result.links.urls).toEqual(["https://outside.com/x"]);
	});
});
