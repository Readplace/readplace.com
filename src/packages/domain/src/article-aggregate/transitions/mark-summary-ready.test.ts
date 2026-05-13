import assert from "node:assert/strict";
import type { Article } from "../article.types";
import { markSummaryReady } from "./mark-summary-ready";

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
		...overrides,
	};
}

describe("markSummaryReady", () => {
	it("flips summary to ready with the supplied summary and excerpt", () => {
		const { article } = markSummaryReady(buildArticle(), {
			summary: "AI-generated summary",
			excerpt: "AI-generated excerpt",
			inputTokens: 1234,
			outputTokens: 567,
		});

		assert.deepEqual(article.summary, {
			kind: "ready",
			summary: "AI-generated summary",
			excerpt: "AI-generated excerpt",
		});
	});

	it("emits a publish-summary-generated effect carrying url and token counts", () => {
		const { effects } = markSummaryReady(
			buildArticle({ url: "https://example.com/post" }),
			{
				summary: "summary",
				excerpt: "excerpt",
				inputTokens: 1234,
				outputTokens: 567,
			},
		);

		assert.deepEqual(effects, [
			{
				kind: "publish-summary-generated",
				url: "https://example.com/post",
				inputTokens: 1234,
				outputTokens: 567,
			},
		]);
	});

	it("declares writes for summary only so a concurrent inline crawl writer is not clobbered", () => {
		const { writes } = markSummaryReady(buildArticle(), {
			summary: "summary",
			excerpt: "excerpt",
			inputTokens: 1,
			outputTokens: 1,
		});

		assert.deepEqual([...writes].sort(), ["summary"]);
	});

	it("preserves crawl so a concurrent inline writer's values are not clobbered on save", () => {
		const before = buildArticle({ crawl: { kind: "ready" } });

		const { article } = markSummaryReady(before, {
			summary: "summary",
			excerpt: "excerpt",
			inputTokens: 1,
			outputTokens: 1,
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

		const { article } = markSummaryReady(before, {
			summary: "summary",
			excerpt: "excerpt",
			inputTokens: 1,
			outputTokens: 1,
		});

		assert.equal(article.metadata.title, "kept title");
		assert.equal(article.freshness.etag, '"kept-etag"');
		assert.equal(article.estimatedReadTime, 3);
	});

	it("does not mutate the input article (pure function)", () => {
		const before = buildArticle();
		const snapshot = JSON.parse(JSON.stringify(before));

		markSummaryReady(before, {
			summary: "summary",
			excerpt: "excerpt",
			inputTokens: 1,
			outputTokens: 1,
		});

		assert.deepEqual(before, snapshot);
	});

	it("exposes its function name so transitionAndPersist can tag the row for the Phase 2 canary measurement", () => {
		assert.equal(markSummaryReady.name, "markSummaryReady");
	});
});
