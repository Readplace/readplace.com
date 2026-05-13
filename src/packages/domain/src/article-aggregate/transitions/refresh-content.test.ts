import assert from "node:assert/strict";
import type { Article } from "../article.types";
import { refreshContent } from "./refresh-content";

function buildArticle(overrides: Partial<Article> = {}): Article {
	return {
		url: "https://example.com/article",
		metadata: {
			title: "Old title",
			siteName: "Example",
			excerpt: "Old excerpt",
			wordCount: 100,
		},
		freshness: {
			etag: '"old-etag"',
			lastModified: "Thu, 01 Jan 2026 00:00:00 GMT",
			contentFetchedAt: "2026-01-01T00:00:00.000Z",
		},
		estimatedReadTime: 1,
		crawl: { kind: "ready" },
		summary: {
			kind: "ready",
			summary: "Old summary",
			excerpt: "Old summary excerpt",
		},
		...overrides,
	};
}

const NOW = "2026-05-13T12:00:00.000Z";

describe("refreshContent", () => {
	it("overwrites metadata, freshness, and estimated read time with the fetched values", () => {
		const before = buildArticle();

		const { article } = refreshContent(before, {
			metadata: {
				title: "New title",
				siteName: "Example",
				excerpt: "New excerpt",
				wordCount: 250,
				imageUrl: "https://example.com/image.jpg",
			},
			freshness: {
				etag: '"new-etag"',
				lastModified: "Sun, 10 May 2026 12:00:00 GMT",
				contentFetchedAt: "2026-05-10T12:00:00.000Z",
			},
			estimatedReadTime: 2,
			now: NOW,
		});

		assert.equal(article.metadata.title, "New title");
		assert.equal(article.metadata.wordCount, 250);
		assert.equal(article.metadata.imageUrl, "https://example.com/image.jpg");
		assert.equal(article.freshness.etag, '"new-etag"');
		assert.equal(article.freshness.contentFetchedAt, "2026-05-10T12:00:00.000Z");
		assert.equal(article.estimatedReadTime, 2);
	});

	it("resets summary to pending so the worker regenerates the cached text", () => {
		const before = buildArticle({
			summary: {
				kind: "ready",
				summary: "stale summary",
				excerpt: "stale excerpt",
				inputTokens: 1234,
				outputTokens: 567,
			},
		});

		const { article } = refreshContent(before, {
			metadata: before.metadata,
			freshness: before.freshness,
			estimatedReadTime: before.estimatedReadTime,
			now: NOW,
		});

		assert.deepEqual(article.summary, { kind: "pending", pendingSince: NOW });
	});

	it("stamps pendingSince with the provided now so the canary can age-gate the row", () => {
		const before = buildArticle();

		const { article } = refreshContent(before, {
			metadata: before.metadata,
			freshness: before.freshness,
			estimatedReadTime: before.estimatedReadTime,
			now: NOW,
		});

		assert.equal(
			article.summary.kind === "pending" ? article.summary.pendingSince : "",
			NOW,
		);
	});

	it("preserves crawl state so a successful refresh does not regress the crawl row", () => {
		const before = buildArticle({ crawl: { kind: "ready" } });

		const { article } = refreshContent(before, {
			metadata: before.metadata,
			freshness: before.freshness,
			estimatedReadTime: before.estimatedReadTime,
			now: NOW,
		});

		assert.deepEqual(article.crawl, { kind: "ready" });
	});

	it("emits a generate-summary effect so the worker is invoked after persistence", () => {
		const before = buildArticle({ url: "https://example.com/post" });

		const { effects } = refreshContent(before, {
			metadata: before.metadata,
			freshness: before.freshness,
			estimatedReadTime: before.estimatedReadTime,
			now: NOW,
		});

		assert.deepEqual(effects, [
			{ kind: "generate-summary", url: "https://example.com/post" },
		]);
	});

	it("declares writes for metadata, freshness, and summary so crawl-state is not clobbered by a concurrent inline writer", () => {
		const before = buildArticle();

		const { writes } = refreshContent(before, {
			metadata: before.metadata,
			freshness: before.freshness,
			estimatedReadTime: before.estimatedReadTime,
			now: NOW,
		});

		assert.deepEqual([...writes].sort(), ["freshness", "metadata", "summary"]);
		assert.ok(!writes.includes("crawl"), "refresh must not declare crawl writes");
	});

	it("does not mutate the input article (pure function)", () => {
		const before = buildArticle();
		const beforeSnapshot = JSON.parse(JSON.stringify(before));

		refreshContent(before, {
			metadata: {
				title: "Different",
				siteName: "Example",
				excerpt: "Different",
				wordCount: 200,
			},
			freshness: {
				etag: '"different"',
				contentFetchedAt: "2026-05-10T12:00:00.000Z",
			},
			estimatedReadTime: 3,
			now: NOW,
		});

		assert.deepEqual(before, beforeSnapshot);
	});
});
