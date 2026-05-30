import { initRefreshArticleIfStale } from "./check-content-freshness";

function createDeps(overrides?: Record<string, unknown>) {
	return {
		findArticleFreshness: async (_url: string) => null,
		findArticleCrawlStatus: async (_url: string) => undefined,
		crawlArticle: async () => ({ status: "failed" as const }),
		parseHtml: () => ({
			ok: true as const,
			article: {
				title: "Test",
				siteName: "example.com",
				excerpt: "Excerpt",
				wordCount: 100,
				content: "<p>Test</p>",
			},
		}),
		publishRefreshArticleContent: async () => {},
		publishUpdateFetchTimestamp: async () => {},
		now: () => new Date("2026-03-20T10:00:00Z"),
		staleTtlMs: 86400000,
		...overrides,
	};
}

describe("refreshArticleIfStale", () => {
	it("returns action 'new' when no article exists for the URL", async () => {
		const deps = createDeps();
		const { refreshArticleIfStale } = initRefreshArticleIfStale(deps);

		const result = await refreshArticleIfStale({ url: "https://example.com/article" });

		expect(result.action).toBe("new");
	});

	it("returns action 'skip' when crawl status is failed (operator-driven recovery via /admin/recrawl)", async () => {
		const deps = createDeps({
			findArticleFreshness: async () => ({
				contentFetchedAt: "2026-03-20T09:00:00Z",
			}),
			findArticleCrawlStatus: async () => ({ status: "failed" as const, reason: "blocked" }),
		});
		const { refreshArticleIfStale } = initRefreshArticleIfStale(deps);

		const result = await refreshArticleIfStale({ url: "https://example.com/article" });

		expect(result.action).toBe("skip");
	});

	it("returns action 'skip' when crawl status is unsupported (terminal — non-html origin)", async () => {
		const deps = createDeps({
			findArticleFreshness: async () => ({
				contentFetchedAt: "2026-03-20T09:00:00Z",
			}),
			findArticleCrawlStatus: async () => ({
				status: "unsupported" as const,
				reason: "non-html content type: application/pdf",
			}),
		});
		const { refreshArticleIfStale } = initRefreshArticleIfStale(deps);

		const result = await refreshArticleIfStale({ url: "https://example.com/article" });

		expect(result.action).toBe("skip");
	});

	it("does not re-publish content when the re-crawl returns unsupported", async () => {
		const publishCalled: string[] = [];
		const deps = createDeps({
			findArticleFreshness: async () => ({
				contentFetchedAt: "2026-03-19T00:00:00Z",
			}),
			findArticleCrawlStatus: async () => ({ status: "ready" as const }),
			crawlArticle: async () => ({
				status: "unsupported" as const,
				reason: "non-html content type: application/pdf",
			}),
			publishRefreshArticleContent: async () => {
				publishCalled.push("refresh");
			},
		});
		const { refreshArticleIfStale } = initRefreshArticleIfStale(deps);

		const result = await refreshArticleIfStale({ url: "https://example.com/article" });

		expect(result.action).toBe("skip");
		expect(publishCalled).toEqual([]);
	});

	it("returns action 'skip' when contentFetchedAt is within TTL", async () => {
		const deps = createDeps({
			findArticleFreshness: async () => ({
				etag: '"abc"',
				contentFetchedAt: "2026-03-20T09:00:00Z",
			}),
			findArticleCrawlStatus: async () => ({ status: "ready" as const }),
		});
		const { refreshArticleIfStale } = initRefreshArticleIfStale(deps);

		const result = await refreshArticleIfStale({ url: "https://example.com/article" });

		expect(result.action).toBe("skip");
	});

	it("returns action 'unchanged' when crawlArticle returns not-modified and publishes fetch timestamp", async () => {
		const publishCalled: string[] = [];
		const deps = createDeps({
			findArticleFreshness: async () => ({
				etag: '"abc"',
				contentFetchedAt: "2026-03-19T00:00:00Z",
			}),
			findArticleCrawlStatus: async () => ({ status: "ready" as const }),
			crawlArticle: async () => ({ status: "not-modified" as const }),
			publishUpdateFetchTimestamp: async () => { publishCalled.push("timestamp"); },
		});
		const { refreshArticleIfStale } = initRefreshArticleIfStale(deps);

		const result = await refreshArticleIfStale({ url: "https://example.com/article" });

		expect(result.action).toBe("unchanged");
		expect(publishCalled).toContain("timestamp");
	});

	it("passes existing etag and lastModified to crawlArticle when stale", async () => {
		const capturedParams: { url: string; etag?: string; lastModified?: string }[] = [];
		const deps = createDeps({
			findArticleFreshness: async () => ({
				etag: '"abc"',
				lastModified: "Wed, 19 Mar 2026 00:00:00 GMT",
				contentFetchedAt: "2026-03-19T00:00:00Z",
			}),
			findArticleCrawlStatus: async () => ({ status: "ready" as const }),
			crawlArticle: async (params: { url: string; etag?: string; lastModified?: string }) => {
				capturedParams.push(params);
				return { status: "not-modified" as const };
			},
		});
		const { refreshArticleIfStale } = initRefreshArticleIfStale(deps);

		await refreshArticleIfStale({ url: "https://example.com/article" });

		expect(capturedParams[0]).toEqual({
			url: "https://example.com/article",
			etag: '"abc"',
			lastModified: "Wed, 19 Mar 2026 00:00:00 GMT",
		});
	});

	it("returns action 'refreshed' when crawlArticle returns fetched content (TTL refresh path)", async () => {
		const publishCalled: string[] = [];
		const deps = createDeps({
			findArticleFreshness: async () => ({
				etag: '"abc"',
				contentFetchedAt: "2026-03-19T00:00:00Z",
			}),
			findArticleCrawlStatus: async () => ({ status: "ready" as const }),
			crawlArticle: async () => ({
				status: "fetched" as const,
				html: "<html>New content</html>",
				etag: '"def"',
				lastModified: "Wed, 20 Mar 2026 10:00:00 GMT",
				bodyHash: "a".repeat(64),
			}),
			publishRefreshArticleContent: async () => { publishCalled.push("refresh"); },
		});
		const { refreshArticleIfStale } = initRefreshArticleIfStale(deps);

		const result = await refreshArticleIfStale({ url: "https://example.com/article" });

		expect(result.action).toBe("refreshed");
		expect(publishCalled).toContain("refresh");
	});

	it("returns action 'refreshed' when crawlArticle returns fetched content (regular save path — no existing headers)", async () => {
		const deps = createDeps({
			findArticleFreshness: async () => ({
				contentFetchedAt: "2026-03-19T00:00:00Z",
			}),
			findArticleCrawlStatus: async () => ({ status: "ready" as const }),
			crawlArticle: async () => ({
				status: "fetched" as const,
				html: "<html>Fresh</html>",
				etag: '"new"',
				bodyHash: "a".repeat(64),
			}),
		});
		const { refreshArticleIfStale } = initRefreshArticleIfStale(deps);

		const result = await refreshArticleIfStale({ url: "https://example.com/article" });

		expect(result.action).toBe("refreshed");
	});

	it("returns action 'skip' when crawlArticle returns failed on re-crawl", async () => {
		const deps = createDeps({
			findArticleFreshness: async () => ({
				contentFetchedAt: "2026-03-19T00:00:00Z",
			}),
			findArticleCrawlStatus: async () => ({ status: "ready" as const }),
			crawlArticle: async () => ({ status: "failed" as const }),
		});
		const { refreshArticleIfStale } = initRefreshArticleIfStale(deps);

		const result = await refreshArticleIfStale({ url: "https://example.com/article" });

		expect(result.action).toBe("skip");
	});

	it("returns action 'skip' when parseHtml returns not ok after fetched content", async () => {
		const deps = createDeps({
			findArticleFreshness: async () => ({
				etag: '"abc"',
				contentFetchedAt: "2026-03-19T00:00:00Z",
			}),
			findArticleCrawlStatus: async () => ({ status: "ready" as const }),
			crawlArticle: async () => ({
				status: "fetched" as const,
				html: "<html>Bad content</html>",
				etag: '"def"',
				bodyHash: "a".repeat(64),
			}),
			parseHtml: () => ({ ok: false as const, reason: "could not parse" }),
		});
		const { refreshArticleIfStale } = initRefreshArticleIfStale(deps);

		const result = await refreshArticleIfStale({ url: "https://example.com/article" });

		expect(result.action).toBe("skip");
	});
});
