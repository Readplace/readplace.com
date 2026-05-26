import { initFetchRedditViaJson, isRedditCommentsUrl, toRedditJsonUrl } from "./reddit-via-json";

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

describe("toRedditJsonUrl", () => {
	it("rewrites a /comments/ URL with a trailing slash to its .json sibling", () => {
		expect(
			toRedditJsonUrl("https://www.reddit.com/r/javascript/comments/1tlsqd1/title/"),
		).toBe("https://www.reddit.com/r/javascript/comments/1tlsqd1/title.json");
	});

	it("rewrites a /comments/ URL without a trailing slash", () => {
		expect(toRedditJsonUrl("https://www.reddit.com/r/javascript/comments/1tlsqd1/title")).toBe(
			"https://www.reddit.com/r/javascript/comments/1tlsqd1/title.json",
		);
	});

	it("strips share_id / utm_* query params (tracking, hurts edge cache)", () => {
		expect(
			toRedditJsonUrl(
				"https://www.reddit.com/r/javascript/comments/1tlsqd1/title/?share_id=abc&utm_source=share",
			),
		).toBe("https://www.reddit.com/r/javascript/comments/1tlsqd1/title.json");
	});
});

describe("initFetchRedditViaJson", () => {
	const sampleListing = (overrides: Record<string, unknown> = {}) => [
		{
			data: {
				children: [
					{
						data: {
							title: "You might not need the repository pattern",
							selftext_html: "<p>Reddit&#39;s rendered post body</p>",
							url_overridden_by_dest: "https://jayfreestone.com/blog/repository-pattern",
							author: "jayfreestone",
							subreddit: "javascript",
							preview: {
								images: [
									{
										source: { url: "https://external-preview.redd.it/abc.png?width=140&amp;height=73" },
									},
								],
							},
							...overrides,
						},
					},
				],
			},
		},
	];

	it("fetches the .json sibling and returns a synthetic HTML body containing the title and selftext", async () => {
		const fetchImpl = jest.fn<Promise<Response>, [string, RequestInit | undefined]>(async () =>
			new Response(JSON.stringify(sampleListing()), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		const handler = initFetchRedditViaJson({ crawlFetch: fetchImpl, logError: noopLogError });

		const result = await handler({
			url: "https://www.reddit.com/r/javascript/comments/1tlsqd1/you_might_not_need_the_repository_pattern/?share_id=abc",
		});

		expect(result.status).toBe("fetched");
		if (result.status !== "fetched") throw new Error("unreachable");
		expect(result.html).toContain("You might not need the repository pattern");
		expect(result.html).toContain("Reddit's rendered post body");
		expect(result.html).toContain("https://jayfreestone.com/blog/repository-pattern");
		expect(result.thumbnailUrl).toBe("https://external-preview.redd.it/abc.png?width=140&height=73");
		expect(fetchImpl).toHaveBeenCalledWith(
			"https://www.reddit.com/r/javascript/comments/1tlsqd1/you_might_not_need_the_repository_pattern.json",
			expect.objectContaining({ headers: { accept: "application/json" } }),
		);
	});

	it("renders plaintext selftext as <p> paragraphs when selftext_html is absent", async () => {
		const fetchImpl: typeof fetch = async () =>
			new Response(
				JSON.stringify(sampleListing({ selftext_html: null, selftext: "first paragraph\n\nsecond <one>" })),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		const handler = initFetchRedditViaJson({ crawlFetch: fetchImpl, logError: noopLogError });

		const result = await handler({
			url: "https://www.reddit.com/r/javascript/comments/1tlsqd1/title/",
		});

		if (result.status !== "fetched") throw new Error("unreachable");
		expect(result.html).toContain("<p>first paragraph</p>");
		expect(result.html).toContain("<p>second &lt;one&gt;</p>");
	});

	it("returns 'fetched' with no thumbnail when the post has no preview image", async () => {
		const fetchImpl: typeof fetch = async () =>
			new Response(
				JSON.stringify(sampleListing({ preview: undefined })),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		const handler = initFetchRedditViaJson({ crawlFetch: fetchImpl, logError: noopLogError });

		const result = await handler({
			url: "https://www.reddit.com/r/javascript/comments/1tlsqd1/title/",
		});

		if (result.status !== "fetched") throw new Error("unreachable");
		expect(result.thumbnailUrl).toBeUndefined();
	});

	it("returns 'failed' on non-2xx response", async () => {
		const logError = jest.fn<void, [string, Error?]>();
		const fetchImpl: typeof fetch = async () => new Response("forbidden", { status: 403 });
		const handler = initFetchRedditViaJson({ crawlFetch: fetchImpl, logError });

		const result = await handler({
			url: "https://www.reddit.com/r/javascript/comments/1tlsqd1/title/",
		});

		expect(result).toEqual({ status: "failed" });
		expect(logError).toHaveBeenCalledWith(expect.stringContaining("HTTP 403"));
	});

	it("returns 'failed' when the JSON listing is missing the post", async () => {
		const logError = jest.fn<void, [string, Error?]>();
		const fetchImpl: typeof fetch = async () =>
			new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
		const handler = initFetchRedditViaJson({ crawlFetch: fetchImpl, logError });

		const result = await handler({
			url: "https://www.reddit.com/r/javascript/comments/1tlsqd1/title/",
		});

		expect(result).toEqual({ status: "failed" });
		expect(logError).toHaveBeenCalledWith(expect.stringContaining("missing post data"));
	});

	it("returns 'failed' when the title is empty (defensive — should not happen for real posts)", async () => {
		const fetchImpl: typeof fetch = async () =>
			new Response(JSON.stringify(sampleListing({ title: "" })), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		const handler = initFetchRedditViaJson({ crawlFetch: fetchImpl, logError: noopLogError });

		const result = await handler({
			url: "https://www.reddit.com/r/javascript/comments/1tlsqd1/title/",
		});

		expect(result).toEqual({ status: "failed" });
	});

	it("returns 'failed' and logs the error when the fetch throws", async () => {
		const logError = jest.fn<void, [string, Error?]>();
		const fetchImpl: typeof fetch = async () => {
			throw new Error("network down");
		};
		const handler = initFetchRedditViaJson({ crawlFetch: fetchImpl, logError });

		const result = await handler({
			url: "https://www.reddit.com/r/javascript/comments/1tlsqd1/title/",
		});

		expect(result).toEqual({ status: "failed" });
		expect(logError).toHaveBeenCalledWith(expect.stringContaining("Reddit-via-json error"), expect.any(Error));
	});

	it("returns 'failed' without an Error when the fetch throws a non-Error", async () => {
		const logError = jest.fn<void, [string, Error?]>();
		const fetchImpl: typeof fetch = async () => {
			throw "string-error";
		};
		const handler = initFetchRedditViaJson({ crawlFetch: fetchImpl, logError });

		const result = await handler({
			url: "https://www.reddit.com/r/javascript/comments/1tlsqd1/title/",
		});

		expect(result).toEqual({ status: "failed" });
		expect(logError).toHaveBeenCalledWith(expect.stringContaining("Reddit-via-json error"), undefined);
	});

	it.each([
		{ scenario: "preview is not an object", preview: "not-an-object" },
		{ scenario: "preview.images is not an array", preview: { images: "x" } },
		{ scenario: "preview.images is empty", preview: { images: [] } },
		{ scenario: "preview.images[0] missing source", preview: { images: [{}] } },
		{ scenario: "preview.images[0].source missing url", preview: { images: [{ source: {} }] } },
		{ scenario: "preview.images[0].source.url is empty", preview: { images: [{ source: { url: "" } }] } },
	])("ignores malformed preview ($scenario)", async ({ preview }) => {
		const fetchImpl: typeof fetch = async () =>
			new Response(JSON.stringify(sampleListing({ preview })), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		const handler = initFetchRedditViaJson({ crawlFetch: fetchImpl, logError: noopLogError });

		const result = await handler({
			url: "https://www.reddit.com/r/javascript/comments/1tlsqd1/title/",
		});

		if (result.status !== "fetched") throw new Error("unreachable");
		expect(result.thumbnailUrl).toBeUndefined();
	});

	it("falls back to url when url_overridden_by_dest is absent", async () => {
		const fetchImpl: typeof fetch = async () =>
			new Response(
				JSON.stringify(
					sampleListing({ url_overridden_by_dest: undefined, url: "https://example.com/article" }),
				),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		const handler = initFetchRedditViaJson({ crawlFetch: fetchImpl, logError: noopLogError });

		const result = await handler({
			url: "https://www.reddit.com/r/javascript/comments/1tlsqd1/title/",
		});

		if (result.status !== "fetched") throw new Error("unreachable");
		expect(result.html).toContain("https://example.com/article");
	});

	it("omits the subreddit/author byline when subreddit is missing", async () => {
		const fetchImpl: typeof fetch = async () =>
			new Response(
				JSON.stringify(sampleListing({ subreddit: "", author: "" })),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		const handler = initFetchRedditViaJson({ crawlFetch: fetchImpl, logError: noopLogError });

		const result = await handler({
			url: "https://www.reddit.com/r/javascript/comments/1tlsqd1/title/",
		});

		if (result.status !== "fetched") throw new Error("unreachable");
		expect(result.html).not.toContain("r/");
	});

	it("omits the linked-URL section when url and url_overridden_by_dest are both absent", async () => {
		const fetchImpl: typeof fetch = async () =>
			new Response(
				JSON.stringify(sampleListing({ url_overridden_by_dest: undefined, url: undefined })),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		const handler = initFetchRedditViaJson({ crawlFetch: fetchImpl, logError: noopLogError });

		const result = await handler({
			url: "https://www.reddit.com/r/javascript/comments/1tlsqd1/title/",
		});

		if (result.status !== "fetched") throw new Error("unreachable");
		expect(result.html).not.toMatch(/<p><a href=/);
	});

	it("returns 'failed' when the JSON is not an array", async () => {
		const logError = jest.fn<void, [string, Error?]>();
		const fetchImpl: typeof fetch = async () =>
			new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
		const handler = initFetchRedditViaJson({ crawlFetch: fetchImpl, logError });

		const result = await handler({
			url: "https://www.reddit.com/r/javascript/comments/1tlsqd1/title/",
		});

		expect(result).toEqual({ status: "failed" });
	});

	it("returns 'failed' when listing.data.children is empty", async () => {
		const fetchImpl: typeof fetch = async () =>
			new Response(JSON.stringify([{ data: { children: [] } }]), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		const handler = initFetchRedditViaJson({ crawlFetch: fetchImpl, logError: noopLogError });

		const result = await handler({
			url: "https://www.reddit.com/r/javascript/comments/1tlsqd1/title/",
		});

		expect(result).toEqual({ status: "failed" });
	});

	it("renders the linked-URL section when url_overridden_by_dest is set", async () => {
		const fetchImpl: typeof fetch = async () =>
			new Response(JSON.stringify(sampleListing()), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		const handler = initFetchRedditViaJson({ crawlFetch: fetchImpl, logError: noopLogError });

		const result = await handler({
			url: "https://www.reddit.com/r/javascript/comments/1tlsqd1/title/",
		});

		if (result.status !== "fetched") throw new Error("unreachable");
		expect(result.html).toMatch(/<a href="https:\/\/jayfreestone\.com\/blog\/repository-pattern">/);
	});
});
