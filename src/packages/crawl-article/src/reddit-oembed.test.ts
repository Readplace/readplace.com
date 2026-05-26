import { initFetchRedditViaOembed, isRedditCommentsUrl, toOembedSubjectUrl } from "./reddit-oembed";

function noopLogError() {}

describe("isRedditCommentsUrl", () => {
	it.each([
		"https://www.reddit.com/r/javascript/comments/1tlsqd1/title/",
		"https://www.reddit.com/r/javascript/comments/1tlsqd1/title",
		"https://www.reddit.com/r/javascript/comments/1tlsqd1/",
		"https://www.reddit.com/r/javascript/comments/1tlsqd1",
		"https://old.reddit.com/r/javascript/comments/1tlsqd1/title/",
		"https://m.reddit.com/r/javascript/comments/1tlsqd1/title/",
		"https://np.reddit.com/r/javascript/comments/1tlsqd1/title/",
		"https://reddit.com/r/javascript/comments/1tlsqd1/title/",
		"https://www.reddit.com/r/javascript/comments/1tlsqd1/title/?utm_source=share",
	])("matches Reddit /comments/ URLs (%s)", (url) => {
		expect(isRedditCommentsUrl(url)).toBe(true);
	});

	it.each([
		"https://www.reddit.com/r/javascript/s/3GQafG3qjy",
		"https://www.reddit.com/r/javascript/",
		"https://www.reddit.com/user/jayfreestone/",
		"https://example.com/r/javascript/comments/1tlsqd1/title/",
		"not a url",
	])("does not match non-/comments/ URLs (%s)", (url) => {
		expect(isRedditCommentsUrl(url)).toBe(false);
	});
});

describe("toOembedSubjectUrl", () => {
	it("normalises hostname to www.reddit.com and strips query params", () => {
		expect(
			toOembedSubjectUrl("https://old.reddit.com/r/javascript/comments/1tlsqd1/title/?share_id=abc&utm_source=share"),
		).toBe("https://www.reddit.com/r/javascript/comments/1tlsqd1/title/");
	});

	it("preserves path for www.reddit.com URLs", () => {
		expect(
			toOembedSubjectUrl("https://www.reddit.com/r/javascript/comments/1tlsqd1/title/"),
		).toBe("https://www.reddit.com/r/javascript/comments/1tlsqd1/title/");
	});
});

describe("initFetchRedditViaOembed", () => {
	const sampleOembed = (overrides: Record<string, unknown> = {}) => ({
		title: "You might not need the repository pattern",
		author_name: "jayfreestone",
		html: '<blockquote class="reddit-embed-bq">Post content</blockquote>',
		type: "rich",
		...overrides,
	});

	it("fetches the oembed endpoint and returns a synthetic HTML body with title and embed", async () => {
		const fetchImpl = jest.fn<Promise<Response>, [string, RequestInit | undefined]>(async () =>
			new Response(JSON.stringify(sampleOembed()), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		const handler = initFetchRedditViaOembed({ crawlFetch: fetchImpl, logError: noopLogError });

		const result = await handler({
			url: "https://www.reddit.com/r/javascript/comments/1tlsqd1/you_might_not_need_the_repository_pattern/?share_id=abc",
		});

		expect(result.status).toBe("fetched");
		if (result.status !== "fetched") throw new Error("unreachable");
		expect(result.html).toContain("You might not need the repository pattern");
		expect(result.html).toContain("u/jayfreestone");
		expect(result.html).toContain("reddit-embed-bq");
		expect(fetchImpl).toHaveBeenCalledWith(
			expect.stringContaining("https://www.reddit.com/oembed?url="),
			expect.objectContaining({ headers: { accept: "application/json" } }),
		);
	});

	it("omits heading and author line when title and author_name are missing", async () => {
		const fetchImpl: typeof fetch = async () =>
			new Response(
				JSON.stringify(sampleOembed({ title: undefined, author_name: undefined })),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		const handler = initFetchRedditViaOembed({ crawlFetch: fetchImpl, logError: noopLogError });

		const result = await handler({
			url: "https://www.reddit.com/r/javascript/comments/1tlsqd1/title/",
		});

		if (result.status !== "fetched") throw new Error("unreachable");
		expect(result.html).not.toContain("<h1>");
		expect(result.html).not.toContain("u/");
		expect(result.html).toContain("reddit-embed-bq");
	});

	it("returns 'failed' on non-2xx response", async () => {
		const logError = jest.fn<void, [string, Error?]>();
		const fetchImpl: typeof fetch = async () => new Response("forbidden", { status: 403 });
		const handler = initFetchRedditViaOembed({ crawlFetch: fetchImpl, logError });

		const result = await handler({
			url: "https://www.reddit.com/r/javascript/comments/1tlsqd1/title/",
		});

		expect(result).toEqual({ status: "failed" });
		expect(logError).toHaveBeenCalledWith(expect.stringContaining("HTTP 403"));
	});

	it("returns 'failed' when title and embed are both empty (html is non-string)", async () => {
		const logError = jest.fn<void, [string, Error?]>();
		const fetchImpl: typeof fetch = async () =>
			new Response(JSON.stringify({ title: "", html: null }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		const handler = initFetchRedditViaOembed({ crawlFetch: fetchImpl, logError });

		const result = await handler({
			url: "https://www.reddit.com/r/javascript/comments/1tlsqd1/title/",
		});

		expect(result).toEqual({ status: "failed" });
		expect(logError).toHaveBeenCalledWith(expect.stringContaining("empty response"));
	});

	it("returns 'failed' and logs the error when the fetch throws", async () => {
		const logError = jest.fn<void, [string, Error?]>();
		const fetchImpl: typeof fetch = async () => {
			throw new Error("network down");
		};
		const handler = initFetchRedditViaOembed({ crawlFetch: fetchImpl, logError });

		const result = await handler({
			url: "https://www.reddit.com/r/javascript/comments/1tlsqd1/title/",
		});

		expect(result).toEqual({ status: "failed" });
		expect(logError).toHaveBeenCalledWith(expect.stringContaining("Reddit oembed error"), expect.any(Error));
	});

	it("returns 'failed' without an Error when the fetch throws a non-Error", async () => {
		const logError = jest.fn<void, [string, Error?]>();
		const fetchImpl: typeof fetch = async () => {
			throw "string-error";
		};
		const handler = initFetchRedditViaOembed({ crawlFetch: fetchImpl, logError });

		const result = await handler({
			url: "https://www.reddit.com/r/javascript/comments/1tlsqd1/title/",
		});

		expect(result).toEqual({ status: "failed" });
		expect(logError).toHaveBeenCalledWith(expect.stringContaining("Reddit oembed error"), undefined);
	});

	it("normalises old.reddit.com to www.reddit.com in the oembed request", async () => {
		const fetchImpl = jest.fn<Promise<Response>, [string, RequestInit | undefined]>(async () =>
			new Response(JSON.stringify(sampleOembed()), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		const handler = initFetchRedditViaOembed({ crawlFetch: fetchImpl, logError: noopLogError });

		await handler({
			url: "https://old.reddit.com/r/javascript/comments/1tlsqd1/title/?utm_source=share",
		});

		const calledUrl = fetchImpl.mock.calls[0][0];
		expect(calledUrl).toContain("www.reddit.com%2Fr%2Fjavascript");
		expect(calledUrl).not.toContain("old.reddit.com");
		expect(calledUrl).not.toContain("utm_source");
	});
});
