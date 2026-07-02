import { getDomain } from "tldts";
import type { CrawlFetch } from "@packages/crawl-article";
import { validateSaveableUrl } from "@packages/domain/article";
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
			validateUrl: validateSaveableUrl,
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
			validateUrl: validateSaveableUrl,
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
			validateUrl: validateSaveableUrl,
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
			validateUrl: validateSaveableUrl,
			crawlFetch: fakeFetch(async () => htmlResponse(html, { url: "https://news.example/issues/42" })),
		});

		const result = await extract("https://news.example/issues/42");

		expect(result.status).toBe("OK");
		if (result.status !== "OK") throw new Error("expected OK");
		expect(result.links.urls).toEqual(["https://outside.com/article"]);
	});

	it("drops links sharing the source's registrable domain (parent and sibling subdomains)", async () => {
		const html = `
			<a href="https://www.ycombinator.com/legal">Legal</a>
			<a href="https://ycombinator.com/faq">FAQ</a>
			<a href="https://news.ycombinator.com/newest">Newest</a>
			<a href="https://other-site.com/article">Article</a>
		`;
		const extract = initExtractLinksFromPageUrl({
			validateUrl: validateSaveableUrl,
			crawlFetch: fakeFetch(async () => htmlResponse(html, { url: "https://news.ycombinator.com/" })),
		});

		const result = await extract("https://news.ycombinator.com/");

		expect(result.status).toBe("OK");
		if (result.status !== "OK") throw new Error("expected OK");
		expect(result.links.urls).toEqual(["https://other-site.com/article"]);
	});

	it("keeps a different registrable domain that shares a multi-part public suffix", async () => {
		const html = `
			<a href="https://bar.bbc.co.uk/page">Sibling</a>
			<a href="https://theguardian.co.uk/news">External</a>
		`;
		const extract = initExtractLinksFromPageUrl({
			validateUrl: validateSaveableUrl,
			crawlFetch: fakeFetch(async () => htmlResponse(html, { url: "https://foo.bbc.co.uk/" })),
		});

		const result = await extract("https://foo.bbc.co.uk/");

		expect(result.status).toBe("OK");
		if (result.status !== "OK") throw new Error("expected OK");
		expect(result.links.urls).toEqual(["https://theguardian.co.uk/news"]);
	});

	it("falls back to host-only matching when the source host is an IP with no registrable domain", async () => {
		const html = `
			<a href="https://93.184.216.34/other">Same host</a>
			<a href="https://other-site.com/article">External</a>
		`;
		const extract = initExtractLinksFromPageUrl({
			validateUrl: validateSaveableUrl,
			crawlFetch: fakeFetch(async () => htmlResponse(html, { url: "https://93.184.216.34/" })),
		});

		const result = await extract("https://93.184.216.34/");

		expect(result.status).toBe("OK");
		if (result.status !== "OK") throw new Error("expected OK");
		expect(result.links.urls).toEqual(["https://other-site.com/article"]);
	});

	it("keeps sibling tenants of a Public Suffix List private-section platform (github.io)", async () => {
		const html = `
			<a href="https://other-user.github.io/their-project">Other tenant</a>
			<a href="https://this-user.github.io/about">Own page</a>
		`;
		const extract = initExtractLinksFromPageUrl({
			validateUrl: validateSaveableUrl,
			crawlFetch: fakeFetch(async () => htmlResponse(html, { url: "https://this-user.github.io/links" })),
		});

		const result = await extract("https://this-user.github.io/links");

		expect(result.status).toBe("OK");
		if (result.status !== "OK") throw new Error("expected OK");
		expect(result.links.urls).toEqual(["https://other-user.github.io/their-project"]);
	});

	it("drops sibling subdomains sharing a registrable domain outside the PSL private section (substack)", async () => {
		const html = `
			<a href="https://another-author.substack.com/p/post">Another author</a>
			<a href="https://outside.com/article">External</a>
		`;
		const extract = initExtractLinksFromPageUrl({
			validateUrl: validateSaveableUrl,
			crawlFetch: fakeFetch(async () => htmlResponse(html, { url: "https://this-author.substack.com/" })),
		});

		const result = await extract("https://this-author.substack.com/");

		expect(result.status).toBe("OK");
		if (result.status !== "OK") throw new Error("expected OK");
		expect(result.links.urls).toEqual(["https://outside.com/article"]);
	});

	it("drops the source URL itself if it appears in the page", async () => {
		const html =
			'<a href="https://news.example/issues/42">Permalink</a><a href="https://news.example/">Home</a><a href="https://outside.com/a">Article</a>';
		const extract = initExtractLinksFromPageUrl({
			validateUrl: validateSaveableUrl,
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
			validateUrl: validateSaveableUrl,
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
			validateUrl: validateSaveableUrl,
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
			validateUrl: validateSaveableUrl,
			crawlFetch: fakeFetch(async () => htmlResponse(html, { url: "https://news.example/issues/42" })),
		});

		const result = await extract("https://news.example/issues/42");

		expect(result.status).toBe("OK");
		if (result.status !== "OK") throw new Error("expected OK");
		expect(result.links.urls).toEqual(["https://outside.com/ok"]);
	});

	it("returns OK with an empty list when the page has no anchors", async () => {
		const extract = initExtractLinksFromPageUrl({
			validateUrl: validateSaveableUrl,
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
			validateUrl: validateSaveableUrl,
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
			validateUrl: validateSaveableUrl,
			crawlFetch: fakeFetch(async () => htmlResponse("")),
		});

		const result = await extract("not a url at all");

		expect(result.status).toBe("INVALID_URL");
	});

	it("maps an AbortError from the fetch timeout to FETCH_FAILED { reason: timeout }", async () => {
		const extract = initExtractLinksFromPageUrl({
			validateUrl: validateSaveableUrl,
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
			validateUrl: validateSaveableUrl,
			crawlFetch: fakeFetch(async () => {
				throw new TypeError("dns failure");
			}),
		});

		const result = await extract("https://news.example/issues/42");

		expect(result).toEqual({ status: "FETCH_FAILED", reason: "network" });
	});

	it("maps a non-Error throw to FETCH_FAILED { reason: network }", async () => {
		const extract = initExtractLinksFromPageUrl({
			validateUrl: validateSaveableUrl,
			crawlFetch: fakeFetch(async () => {
				throw "boom";
			}),
		});

		const result = await extract("https://news.example/issues/42");

		expect(result).toEqual({ status: "FETCH_FAILED", reason: "network" });
	});

	it("maps an AbortError that fires before the timeout to FETCH_FAILED { reason: timeout }", async () => {
		const extract = initExtractLinksFromPageUrl({
			validateUrl: validateSaveableUrl,
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
			validateUrl: validateSaveableUrl,
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

	it("rejects via Content-Length header without downloading the body", async () => {
		let bodyRead = false;
		const extract = initExtractLinksFromPageUrl({
			validateUrl: validateSaveableUrl,
			crawlFetch: fakeFetch(async () => {
				const response = new Response("short", {
					status: 200,
					headers: {
						"content-type": "text/html",
						"content-length": String(6 * 1024 * 1024),
					},
				});
				Object.defineProperty(response, "url", { value: "https://news.example/issues/42" });
				const originalArrayBuffer = response.arrayBuffer.bind(response);
				response.arrayBuffer = async () => {
					bodyRead = true;
					return originalArrayBuffer();
				};
				return response;
			}),
		});

		const result = await extract("https://news.example/issues/42");

		expect(result).toEqual({ status: "FETCH_FAILED", reason: "too_large" });
		expect(bodyRead).toBe(false);
	});

	it("rejects responses larger than 5 MiB when Content-Length is absent", async () => {
		const body = "a".repeat(5 * 1024 * 1024 + 1);
		const extract = initExtractLinksFromPageUrl({
			validateUrl: validateSaveableUrl,
			crawlFetch: fakeFetch(async () => htmlResponse(body, { url: "https://news.example/issues/42" })),
		});

		const result = await extract("https://news.example/issues/42");

		expect(result).toEqual({ status: "FETCH_FAILED", reason: "too_large" });
	});

	it("aborts the stream and returns too_large when a chunked (Content-Length-less) body streams past 5 MiB", async () => {
		const oversized = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(5 * 1024 * 1024 + 1));
				controller.close();
			},
		});
		const extract = initExtractLinksFromPageUrl({
			validateUrl: validateSaveableUrl,
			crawlFetch: fakeFetch(
				async () => new Response(oversized, { status: 200, headers: { "content-type": "text/html" } }),
			),
		});

		const result = await extract("https://news.example/issues/42");

		expect(result).toEqual({ status: "FETCH_FAILED", reason: "too_large" });
	});

	it("returns UNSUPPORTED_CONTENT_TYPE for non-HTML responses", async () => {
		const extract = initExtractLinksFromPageUrl({
			validateUrl: validateSaveableUrl,
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
			validateUrl: validateSaveableUrl,
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
			validateUrl: validateSaveableUrl,
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

describe("documents why a Public Suffix List, not label-slicing, decides the registrable domain (production guarded by the bbc.co.uk, ycombinator, and github.io behavioral tests above)", () => {
	const lastTwoLabels = (host: string) => host.split(".").slice(-2).join(".");
	const lastThreeLabels = (host: string) => host.split(".").slice(-3).join(".");

	it("a last-two-labels rule merges bbc.co.uk with theguardian.co.uk; getDomain keeps them distinct", () => {
		expect(lastTwoLabels("foo.bbc.co.uk")).toBe(lastTwoLabels("theguardian.co.uk"));
		expect(getDomain("foo.bbc.co.uk", { allowPrivateDomains: true })).not.toBe(
			getDomain("theguardian.co.uk", { allowPrivateDomains: true }),
		);
	});

	it("a last-three-labels rule splits ycombinator.com subdomains; getDomain groups them", () => {
		expect(lastThreeLabels("news.ycombinator.com")).not.toBe(lastThreeLabels("www.ycombinator.com"));
		expect(getDomain("news.ycombinator.com", { allowPrivateDomains: true })).toBe(
			getDomain("www.ycombinator.com", { allowPrivateDomains: true }),
		);
	});

	it("allowPrivateDomains keeps github.io tenants distinct that the default getDomain merges", () => {
		expect(getDomain("this-user.github.io")).toBe(getDomain("other-user.github.io"));
		expect(getDomain("this-user.github.io", { allowPrivateDomains: true })).not.toBe(
			getDomain("other-user.github.io", { allowPrivateDomains: true }),
		);
	});
});
