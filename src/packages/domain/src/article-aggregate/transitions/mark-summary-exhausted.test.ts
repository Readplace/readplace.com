import assert from "node:assert/strict";
import type { Article } from "../article.types";
import { markSummaryExhausted } from "./mark-summary-exhausted";

function buildArticle(overrides: Partial<Article> = {}): Article {
	return {
		url: "https://example.com/article",
		metadata: {
			title: "Title",
			siteName: "Example",
			excerpt: "Excerpt",
			wordCount: 100,
		},
		freshness: { contentFetchedAt: "2026-01-01T00:00:00.000Z" },
		estimatedReadTime: 1,
		crawl: { kind: "ready" },
		summary: { kind: "pending", pendingSince: "2026-01-01T00:00:00.000Z" },
		summaryAutoHeal: { attempts: 0 },
		...overrides,
	};
}

describe("markSummaryExhausted", () => {
	it("flips summary to failed with the supplied reason", () => {
		const { article } = markSummaryExhausted(buildArticle(), {
			reason: "exceeded SQS maxReceiveCount",
			receiveCount: 4,
		});

		assert.deepEqual(article.summary, {
			kind: "failed",
			reason: "exceeded SQS maxReceiveCount",
		});
	});

	it("emits a publish-summary-generation-failed effect carrying the url, reason, and receiveCount", () => {
		const { effects } = markSummaryExhausted(
			buildArticle({ url: "https://example.com/post" }),
			{ reason: "exceeded SQS maxReceiveCount", receiveCount: 7 },
		);

		assert.deepEqual(effects, [
			{
				kind: "publish-summary-generation-failed",
				url: "https://example.com/post",
				reason: "exceeded SQS maxReceiveCount",
				receiveCount: 7,
			},
		]);
	});

	it("declares writes for summary only so a concurrent inline crawl writer is not clobbered", () => {
		const { writes } = markSummaryExhausted(buildArticle(), {
			reason: "x",
			receiveCount: 1,
		});

		assert.deepEqual([...writes].sort(), ["summary"]);
	});

	it("preserves crawl so a concurrent inline writer's values are not clobbered on save (this transition is the summary-only DLQ path, unlike markCrawlExhausted which is cross-axis)", () => {
		const before = buildArticle({ crawl: { kind: "ready" } });

		const { article } = markSummaryExhausted(before, {
			reason: "x",
			receiveCount: 1,
		});

		assert.deepEqual(article.crawl, { kind: "ready" });
	});

	it("preserves metadata and freshness so a concurrent inline writer's values are not clobbered on save", () => {
		const before = buildArticle({
			metadata: {
				title: "kept title",
				siteName: "kept site",
				excerpt: "kept excerpt",
				wordCount: 500,
			},
			freshness: {
				etag: '"kept-etag"',
				contentFetchedAt: "2026-05-10T12:00:00.000Z",
			},
			estimatedReadTime: 3,
		});

		const { article } = markSummaryExhausted(before, {
			reason: "x",
			receiveCount: 1,
		});

		assert.equal(article.metadata.title, "kept title");
		assert.equal(article.freshness.etag, '"kept-etag"');
		assert.equal(article.estimatedReadTime, 3);
	});

	it("does not mutate the input article (pure function)", () => {
		const before = buildArticle();
		const snapshot = JSON.parse(JSON.stringify(before));

		markSummaryExhausted(before, { reason: "x", receiveCount: 1 });

		assert.deepEqual(before, snapshot);
	});

	it("exposes its function name so transitionAndPersist can tag the row for the Phase 2 canary measurement", () => {
		assert.equal(markSummaryExhausted.name, "markSummaryExhausted");
	});
});
