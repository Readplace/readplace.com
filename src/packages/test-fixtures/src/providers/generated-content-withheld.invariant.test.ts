import { ANONYMOUS_VIEWER, SUMMARY_WITHHELD_REASON, generatedContentAccessFor } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryArticleCrawl } from "./article-crawl/in-memory-article-crawl";
import { initInMemoryClaimResolutionOnView } from "./article-crawl/in-memory-resolution-on-view";
import { initInMemoryArticleStore } from "./article-store/in-memory-article-store";
import { initInMemoryGeneratedSummary } from "./article-summary/in-memory-generated-summary";
import { initInMemoryPastReads } from "./related-articles/in-memory-past-reads";
import { initInMemoryRelatedArticles } from "./related-articles/in-memory-related-articles";

const WITHHELD = generatedContentAccessFor({ viewerCountry: "CN", storefront: undefined });
const URL = "https://example.com/article";
const RELATED_URL = "https://example.com/earlier";
const USER_ID = UserIdSchema.parse("user_abc");
const SENTINEL = "generated-text-sentinel-8d4f";
const AT = new Date("2026-11-20T00:00:00.000Z");
const WITHHELD_SUMMARY = { status: "skipped", reason: SUMMARY_WITHHELD_REASON };

type InMemorySummary = ReturnType<typeof initInMemoryGeneratedSummary>;

const STORED_SUMMARY_STATES: ReadonlyArray<{ name: string; store: (summary: InMemorySummary) => Promise<void> }> = [
	{ name: "no stored summary", store: async () => {} },
	{ name: "a pending summary", store: (summary) => summary.markSummaryPending({ url: URL }) },
	{ name: "a ready summary", store: (summary) => summary.markSummaryReady({ url: URL, summary: SENTINEL, excerpt: SENTINEL }) },
	{ name: "a failed summary", store: (summary) => summary.markSummaryFailed({ url: URL, reason: SENTINEL }) },
	{ name: "a skipped summary", store: (summary) => summary.markSummarySkipped({ url: URL, reason: SENTINEL }) },
];

describe("generated content withheld from a viewer in mainland China", () => {
	it.each(STORED_SUMMARY_STATES)("findGeneratedSummary returns the withheld skip for $name", async ({ store }) => {
		const summary = initInMemoryGeneratedSummary({ findItemOwner: async () => undefined });
		await store(summary);

		const result = await summary.findGeneratedSummary({ url: URL, viewer: ANONYMOUS_VIEWER, generatedContent: WITHHELD });

		expect(result).toEqual(WITHHELD_SUMMARY);
		expect(JSON.stringify(result)).not.toContain(SENTINEL);
	});

	it("claimResolutionOnView returns the withheld skip", async () => {
		const crawl = initInMemoryArticleCrawl({ now: () => AT });
		const summary = initInMemoryGeneratedSummary({ findItemOwner: async () => undefined });
		const claim = initInMemoryClaimResolutionOnView({ crawl, summary, findItemOwner: async () => undefined, now: () => AT });
		await crawl.markCrawlPending({ url: URL, measured: false, meteredLegs: "deferred" });
		await crawl.markCrawlFailed({ url: URL, reason: "blocked" });
		await summary.markSummaryFailed({ url: URL, reason: SENTINEL });

		const result = await claim({ url: URL, axes: "crawl-and-summary", viewer: ANONYMOUS_VIEWER, generatedContent: WITHHELD });

		expect(result).toMatchObject({ kind: "claimed", summary: WITHHELD_SUMMARY });
		expect(JSON.stringify(result)).not.toContain(SENTINEL);
	});

	it("findRelatedArticles reports skipped over ready suggestions", async () => {
		const articleStore = initInMemoryArticleStore();
		const related = initInMemoryRelatedArticles({
			findArticleByUrl: articleStore.findArticleByUrl,
			findArticleById: articleStore.findArticleById,
			findItemOwner: articleStore.findItemOwner,
		});
		await related.markRelatedArticlesReady({
			userId: USER_ID,
			url: URL,
			relatedArticles: [{ url: RELATED_URL, reason: SENTINEL }],
			inputTokens: 1,
			outputTokens: 1,
			at: AT,
		});

		const result = await related.findRelatedArticles({ userId: USER_ID, url: URL, generatedContent: WITHHELD });

		expect(result).toEqual({ status: "skipped" });
	});

	it("findPastReads reports no items over ready past reads", async () => {
		const articleStore = initInMemoryArticleStore();
		const pastReads = initInMemoryPastReads({
			findArticleByUrl: articleStore.findArticleByUrl,
			findArticleById: articleStore.findArticleById,
			findItemOwner: articleStore.findItemOwner,
		});
		await pastReads.markPastReadsReady({
			userId: USER_ID,
			url: URL,
			pastReads: [{ url: RELATED_URL, reason: SENTINEL }],
			fingerprint: "fp",
			inputTokens: 1,
			outputTokens: 1,
			at: AT,
		});

		const result = await pastReads.findPastReads({ userId: USER_ID, url: URL, generatedContent: WITHHELD });

		expect(result).toEqual({ status: "ready", items: [] });
	});
});
