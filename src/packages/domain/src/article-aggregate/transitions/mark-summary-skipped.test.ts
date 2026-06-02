import assert from "node:assert/strict";
import type { Article } from "../article.types";
import { markSummarySkipped } from "./mark-summary-skipped";

const NOW = "2026-05-30T12:00:00.000Z";

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

describe("markSummarySkipped", () => {
	it("flips summary to skipped with the supplied SummarySkipReason", () => {
		const { article } = markSummarySkipped(buildArticle(), {
			reason: "content-too-short",
			now: NOW,
		});

		assert.deepEqual(article.summary, {
			kind: "skipped",
			reason: "content-too-short",
		});
	});

	it("emits a publish-reader-view-loading-succeeded effect with hasSummary=false (skip still reaches the successful reader-view state)", () => {
		const { effects } = markSummarySkipped(
			buildArticle({ url: "https://example.com/post" }),
			{ reason: "ai-unavailable", now: NOW },
		);

		assert.deepEqual(effects, [
			{
				kind: "publish-reader-view-loading-succeeded",
				url: "https://example.com/post",
				succeededAt: NOW,
				hasSummary: false,
			},
		]);
	});

	it("declares writes for summary only so a concurrent inline crawl writer is not clobbered", () => {
		const { writes } = markSummarySkipped(buildArticle(), {
			reason: "content-too-short",
			now: NOW,
		});

		assert.deepEqual([...writes].sort(), ["summary"]);
	});

	it("preserves crawl so a concurrent inline writer's values are not clobbered on save", () => {
		const before = buildArticle({ crawl: { kind: "ready" } });

		const { article } = markSummarySkipped(before, {
			reason: "content-too-short",
			now: NOW,
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

		const { article } = markSummarySkipped(before, {
			reason: "content-too-short",
			now: NOW,
		});

		assert.equal(article.metadata.title, "kept title");
		assert.equal(article.freshness.etag, '"kept-etag"');
		assert.equal(article.estimatedReadTime, 3);
	});

	it("does not mutate the input article (pure function)", () => {
		const before = buildArticle();
		const snapshot = JSON.parse(JSON.stringify(before));

		markSummarySkipped(before, { reason: "content-too-short", now: NOW });

		assert.deepEqual(before, snapshot);
	});

	it("exposes its function name so transitionAndPersist can tag the row for the Phase 2 canary measurement", () => {
		assert.equal(markSummarySkipped.name, "markSummarySkipped");
	});
});
