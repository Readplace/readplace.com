import assert from "node:assert/strict";
import type { Article } from "../article.types";
import { markCrawlFailed } from "./mark-crawl-failed";

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
		crawl: { kind: "pending", pendingSince: "2026-01-01T00:00:00.000Z" },
		summary: { kind: "pending", pendingSince: "2026-01-01T00:00:00.000Z" },
		summaryAutoHeal: { attempts: 0 },
		...overrides,
	};
}

describe("markCrawlFailed", () => {
	it("flips crawl to failed with the supplied reason", () => {
		const { article } = markCrawlFailed(buildArticle(), {
			reason: "fetch returned 500",
		});

		assert.deepEqual(article.crawl, {
			kind: "failed",
			reason: "fetch returned 500",
		});
	});

	it("emits no effects (terminal status write only)", () => {
		const { effects } = markCrawlFailed(buildArticle(), {
			reason: "fetch returned 500",
		});

		assert.deepEqual(effects, []);
	});

	it("declares writes for crawl only so a concurrent inline summary writer is not clobbered", () => {
		const { writes } = markCrawlFailed(buildArticle(), {
			reason: "fetch returned 500",
		});

		assert.deepEqual([...writes].sort(), ["crawl"]);
	});

	it("preserves summary so a concurrent inline writer's values are not clobbered on save", () => {
		const before = buildArticle({
			summary: {
				kind: "ready",
				summary: "kept summary",
				excerpt: "kept excerpt",
			},
		});

		const { article } = markCrawlFailed(before, { reason: "fetch returned 500" });

		assert.deepEqual(article.summary, {
			kind: "ready",
			summary: "kept summary",
			excerpt: "kept excerpt",
		});
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

		const { article } = markCrawlFailed(before, { reason: "fetch returned 500" });

		assert.equal(article.metadata.title, "kept title");
		assert.equal(article.freshness.etag, '"kept-etag"');
		assert.equal(article.estimatedReadTime, 3);
	});

	it("does not mutate the input article (pure function)", () => {
		const before = buildArticle();
		const snapshot = JSON.parse(JSON.stringify(before));

		markCrawlFailed(before, { reason: "fetch returned 500" });

		assert.deepEqual(before, snapshot);
	});

	it("exposes its function name so transitionAndPersist can tag the row for the Phase 2 canary measurement", () => {
		assert.equal(markCrawlFailed.name, "markCrawlFailed");
	});
});
