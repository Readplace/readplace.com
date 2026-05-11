import {
	AggregateConcurrencyError,
	type Article,
	type Minutes,
} from "@packages/domain/article";
import { initInMemoryArticleCrawl } from "../article-crawl";
import { initInMemoryArticleStore } from "../article-store/in-memory-article-store";
import { createFakeSummaryProvider } from "../../fixture";
import { initBridgeArticleStore } from "./in-memory-bridge-article-store";

const URL = "https://example.com/article";

interface Harness {
	articleStore: ReturnType<typeof initInMemoryArticleStore>;
	articleCrawl: ReturnType<typeof initInMemoryArticleCrawl>;
	summary: ReturnType<typeof createFakeSummaryProvider>;
	bridge: ReturnType<typeof initBridgeArticleStore>;
}

function buildHarness(): Harness {
	const articleStore = initInMemoryArticleStore();
	const articleCrawl = initInMemoryArticleCrawl();
	const summary = createFakeSummaryProvider();
	const bridge = initBridgeArticleStore({
		readers: {
			findArticleByUrl: async (url) => {
				const article = await articleStore.findArticleByUrl(url);
				if (!article) return null;
				return {
					id: article.id,
					url: article.url,
					metadata: article.metadata,
					estimatedReadTime: article.estimatedReadTime,
					contentSourceTier: article.contentSourceTier,
				};
			},
			findArticleCrawlStatus: articleCrawl.findArticleCrawlStatus,
			findGeneratedSummary: summary.findGeneratedSummary,
		},
		writers: {
			forceMarkCrawlPending: articleCrawl.forceMarkCrawlPending,
			markCrawlReady: articleCrawl.markCrawlReady,
			markCrawlFailed: articleCrawl.markCrawlFailed,
			markCrawlUnsupported: articleCrawl.markCrawlUnsupported,
			forceMarkSummaryPending: summary.forceMarkSummaryPending,
			markSummaryReady: summary.markSummaryReady,
			markSummaryFailed: summary.markSummaryFailed,
			markSummarySkipped: summary.markSummarySkipped,
			writeMetadata: articleStore.writeMetadata,
		},
	});
	return { articleStore, articleCrawl, summary, bridge };
}

async function seedRow(
	harness: Harness,
	overrides?: {
		crawl?: "pending" | "ready" | "failed" | "unsupported";
		summary?: "pending" | "ready";
	},
): Promise<void> {
	await harness.articleStore.saveArticleGlobally({
		url: URL,
		metadata: {
			title: "T",
			siteName: "example.com",
			excerpt: "E",
			wordCount: 100,
		},
		estimatedReadTime: 1 as Minutes,
	});
	const crawl = overrides?.crawl ?? "ready";
	if (crawl === "ready") {
		await harness.articleCrawl.markCrawlReady({ url: URL });
	} else if (crawl === "failed") {
		await harness.articleCrawl.markCrawlFailed({
			url: URL,
			reason: "ETIMEDOUT",
		});
	} else if (crawl === "unsupported") {
		await harness.articleCrawl.markCrawlUnsupported({
			url: URL,
			reason: "application/pdf",
		});
	} else {
		await harness.articleCrawl.markCrawlPending({ url: URL });
	}
	const sum = overrides?.summary ?? "ready";
	if (sum === "ready") {
		harness.summary.markSummaryReady({
			url: URL,
			summary: "Generated.",
			excerpt: "Lead.",
		});
	} else {
		await harness.summary.markSummaryPending({ url: URL });
	}
}

describe("initBridgeArticleStore.load", () => {
	it("returns undefined when articleStore has no row for the URL", async () => {
		const harness = buildHarness();
		const result = await harness.bridge.load(URL);
		expect(result).toBeUndefined();
	});

	it("projects a fully-seeded row into an Article aggregate at version 0", async () => {
		const harness = buildHarness();
		await seedRow(harness);

		const article = await harness.bridge.load(URL);
		expect(article?.version).toBe(0);
		expect(article?.crawl).toEqual({ status: "ready" });
		expect(article?.summary).toEqual({
			status: "ready",
			summary: "Generated.",
			excerpt: "Lead.",
			inputTokens: 0,
			outputTokens: 0,
		});
		expect(article?.metadata.title).toBe("T");
	});

	it("projects a failed crawl + failed summary", async () => {
		const harness = buildHarness();
		await harness.articleStore.saveArticleGlobally({
			url: URL,
			metadata: { title: "T", siteName: "x", excerpt: "", wordCount: 0 },
			estimatedReadTime: 0 as Minutes,
		});
		await harness.articleCrawl.markCrawlFailed({
			url: URL,
			reason: "ETIMEDOUT",
		});
		await harness.summary.markSummaryFailed({ url: URL, reason: "AI down" });

		const article = await harness.bridge.load(URL);
		expect(article?.crawl).toEqual({
			status: "failed",
			reason: "ETIMEDOUT",
			failedAt: "",
		});
		expect(article?.summary).toEqual({
			status: "failed",
			reason: "AI down",
		});
	});

	it("projects an unsupported crawl", async () => {
		const harness = buildHarness();
		await harness.articleStore.saveArticleGlobally({
			url: URL,
			metadata: { title: "T", siteName: "x", excerpt: "", wordCount: 0 },
			estimatedReadTime: 0 as Minutes,
		});
		await harness.articleCrawl.markCrawlUnsupported({
			url: URL,
			reason: "application/pdf",
		});

		const article = await harness.bridge.load(URL);
		expect(article?.crawl).toEqual({
			status: "unsupported",
			reason: "application/pdf",
			failedAt: "",
		});
	});

	it("projects a skipped summary with a reason", async () => {
		const harness = buildHarness();
		await harness.articleStore.saveArticleGlobally({
			url: URL,
			metadata: { title: "T", siteName: "x", excerpt: "", wordCount: 0 },
			estimatedReadTime: 0 as Minutes,
		});
		await harness.summary.markSummarySkipped({
			url: URL,
			reason: "content-too-short",
		});

		const article = await harness.bridge.load(URL);
		expect(article?.summary).toEqual({
			status: "skipped",
			reason: "content-too-short",
		});
	});

	it("projects a skipped summary without a reason", async () => {
		const harness = buildHarness();
		await harness.articleStore.saveArticleGlobally({
			url: URL,
			metadata: { title: "T", siteName: "x", excerpt: "", wordCount: 0 },
			estimatedReadTime: 0 as Minutes,
		});
		await harness.summary.markSummarySkipped({ url: URL });

		const article = await harness.bridge.load(URL);
		expect(article?.summary).toEqual({ status: "skipped" });
	});

	it("projects a ready summary without an excerpt as the ready kind without an excerpt key", async () => {
		const harness = buildHarness();
		await harness.articleStore.saveArticleGlobally({
			url: URL,
			metadata: { title: "T", siteName: "x", excerpt: "", wordCount: 0 },
			estimatedReadTime: 0 as Minutes,
		});
		harness.summary.markSummaryReady({ url: URL, summary: "S", excerpt: "" });

		const article = await harness.bridge.load(URL);
		expect(article?.summary).toEqual({
			status: "ready",
			summary: "S",
			inputTokens: 0,
			outputTokens: 0,
		});
		expect(article?.summary).not.toHaveProperty("excerpt");
	});

	it("projects a row missing crawl/summary entirely as pending sub-states", async () => {
		const harness = buildHarness();
		await harness.articleStore.saveArticleGlobally({
			url: URL,
			metadata: { title: "T", siteName: "x", excerpt: "", wordCount: 0 },
			estimatedReadTime: 0 as Minutes,
		});

		const article = await harness.bridge.load(URL);
		expect(article?.crawl).toEqual({ status: "pending" });
		expect(article?.summary).toEqual({ status: "pending" });
	});
});

describe("initBridgeArticleStore.save", () => {
	function makeArticle(overrides: Partial<Article> = {}): Article {
		return {
			url: URL,
			version: 0,
			crawl: { status: "ready" },
			summary: {
				status: "ready",
				summary: "s",
				inputTokens: 0,
				outputTokens: 0,
			},
			metadata: {
				title: "T",
				siteName: "x",
				excerpt: "",
				wordCount: 0,
			},
			estimatedReadTime: 0 as Minutes,
			...overrides,
		};
	}

	it("routes crawl=pending through forceMarkCrawlPending so legacy readers see status=pending", async () => {
		// This is the contract the bridge exists to maintain: the existing
		// reader path (articleCrawl.findArticleCrawlStatus, used by
		// resolveReaderState) reflects the aggregate write the moment save()
		// resolves — no synchronization gap.
		const harness = buildHarness();
		await seedRow(harness);
		await harness.bridge.save({
			article: makeArticle({ crawl: { status: "pending" } }),
			expectedVersion: 0,
		});
		expect(
			await harness.articleCrawl.findArticleCrawlStatus(URL),
		).toMatchObject({ status: "pending" });
	});

	it("routes summary=pending through forceMarkSummaryPending so the existing summary fixture flips", async () => {
		// The /admin/recrawl route test asserts harness.summary.findGeneratedSummary
		// returns { status: 'pending' } after a recrawl. The bridge's save MUST
		// trigger that flip or the existing test breaks.
		const harness = buildHarness();
		await seedRow(harness);
		await harness.bridge.save({
			article: makeArticle({ summary: { status: "pending" } }),
			expectedVersion: 0,
		});
		expect(await harness.summary.findGeneratedSummary(URL)).toEqual({
			status: "pending",
		});
	});

	it("routes crawl=ready through markCrawlReady", async () => {
		const harness = buildHarness();
		await seedRow(harness, { crawl: "failed" });
		await harness.bridge.save({
			article: makeArticle({ crawl: { status: "ready" } }),
			expectedVersion: 0,
		});
		expect(
			await harness.articleCrawl.findArticleCrawlStatus(URL),
		).toEqual({ status: "ready" });
	});

	it("routes crawl=failed through markCrawlFailed with the reason", async () => {
		const harness = buildHarness();
		await seedRow(harness, { crawl: "pending" });
		await harness.bridge.save({
			article: makeArticle({
				crawl: {
					status: "failed",
					reason: "EHOSTUNREACH",
					failedAt: "2026-05-11T00:00:00Z",
				},
			}),
			expectedVersion: 0,
		});
		expect(
			await harness.articleCrawl.findArticleCrawlStatus(URL),
		).toEqual({ status: "failed", reason: "EHOSTUNREACH" });
	});

	it("routes crawl=unsupported through markCrawlUnsupported with the reason", async () => {
		const harness = buildHarness();
		await seedRow(harness, { crawl: "pending" });
		await harness.bridge.save({
			article: makeArticle({
				crawl: {
					status: "unsupported",
					reason: "application/pdf",
					failedAt: "2026-05-11T00:00:00Z",
				},
			}),
			expectedVersion: 0,
		});
		expect(
			await harness.articleCrawl.findArticleCrawlStatus(URL),
		).toEqual({ status: "unsupported", reason: "application/pdf" });
	});

	it("routes summary=ready through markSummaryReady, propagating excerpt", async () => {
		const harness = buildHarness();
		await seedRow(harness, { summary: "pending" });
		await harness.bridge.save({
			article: makeArticle({
				summary: {
					status: "ready",
					summary: "Generated.",
					excerpt: "Lead.",
					inputTokens: 10,
					outputTokens: 5,
				},
			}),
			expectedVersion: 0,
		});
		expect(await harness.summary.findGeneratedSummary(URL)).toEqual({
			status: "ready",
			summary: "Generated.",
			excerpt: "Lead.",
		});
	});

	it("routes summary=failed through markSummaryFailed", async () => {
		const harness = buildHarness();
		await seedRow(harness, { summary: "pending" });
		await harness.bridge.save({
			article: makeArticle({
				summary: { status: "failed", reason: "AI throttled" },
			}),
			expectedVersion: 0,
		});
		expect(await harness.summary.findGeneratedSummary(URL)).toEqual({
			status: "failed",
			reason: "AI throttled",
		});
	});

	it("routes summary=skipped (with reason) through markSummarySkipped", async () => {
		const harness = buildHarness();
		await seedRow(harness, { summary: "pending" });
		await harness.bridge.save({
			article: makeArticle({
				summary: { status: "skipped", reason: "content-too-short" },
			}),
			expectedVersion: 0,
		});
		expect(await harness.summary.findGeneratedSummary(URL)).toEqual({
			status: "skipped",
			reason: "content-too-short",
		});
	});

	it("routes summary=skipped (without reason) through markSummarySkipped", async () => {
		const harness = buildHarness();
		await seedRow(harness, { summary: "pending" });
		await harness.bridge.save({
			article: makeArticle({ summary: { status: "skipped" } }),
			expectedVersion: 0,
		});
		expect(await harness.summary.findGeneratedSummary(URL)).toEqual({
			status: "skipped",
		});
	});

	it("bumps version on a successful save (one save = +1)", async () => {
		const harness = buildHarness();
		await seedRow(harness);
		expect(harness.bridge.peekVersion(URL)).toBe(0);
		await harness.bridge.save({
			article: makeArticle({ summary: { status: "pending" } }),
			expectedVersion: 0,
		});
		expect(harness.bridge.peekVersion(URL)).toBe(1);
	});

	it("throws AggregateConcurrencyError when expectedVersion does not match", async () => {
		const harness = buildHarness();
		await seedRow(harness);
		await expect(
			harness.bridge.save({
				article: makeArticle({ summary: { status: "pending" } }),
				expectedVersion: 4,
			}),
		).rejects.toBeInstanceOf(AggregateConcurrencyError);
	});

	it("propagates metadata changes through writeMetadata", async () => {
		const harness = buildHarness();
		await seedRow(harness);
		await harness.bridge.save({
			article: makeArticle({
				metadata: {
					title: "New title",
					siteName: "example.com",
					excerpt: "New excerpt",
					wordCount: 500,
				},
				estimatedReadTime: 3 as Minutes,
			}),
			expectedVersion: 0,
		});

		const stored = await harness.articleStore.findArticleByUrl(URL);
		expect(stored?.metadata.title).toBe("New title");
		expect(stored?.estimatedReadTime).toBe(3);
	});
});
