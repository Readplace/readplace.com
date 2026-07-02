import assert from "node:assert/strict";
import type { Article } from "../article.types";
import { markCrawlNotFound } from "./mark-crawl-not-found";

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

describe("markCrawlNotFound", () => {
	it("flips crawl to failed with the supplied not-found reason", () => {
		const { article } = markCrawlNotFound(buildArticle(), {
			reason: { kind: "not-found", httpStatus: 404 },
		});

		assert.deepEqual(article.crawl, {
			kind: "failed",
			reason: { kind: "not-found", httpStatus: 404 },
		});
	});

	it("leaves a crawl=ready row untouched so a stale not-found verdict never demotes content another writer already served", () => {
		const before = buildArticle({
			crawl: { kind: "ready" },
			summary: { kind: "ready", summary: "kept", excerpt: "kept" },
		});

		const { article, effects, writes } = markCrawlNotFound(before, {
			reason: { kind: "not-found", httpStatus: 404 },
		});

		assert.deepEqual(article, before);
		assert.deepEqual(effects, []);
		assert.deepEqual(writes, []);
	});

	it("flips summary to skipped with reason 'crawl-failed' so the summary canary doesn't keep flagging the row", () => {
		const { article } = markCrawlNotFound(buildArticle(), {
			reason: { kind: "not-found", httpStatus: 404 },
		});

		assert.deepEqual(article.summary, {
			kind: "skipped",
			reason: "crawl-failed",
		});
	});

	it("emits no effects (a dead link resolves to a failed reader view, not a succeeded one)", () => {
		const { effects } = markCrawlNotFound(buildArticle(), {
			reason: { kind: "not-found", httpStatus: 404 },
		});

		assert.deepEqual(effects, []);
	});

	it("declares writes for crawl and summary so both axes terminalise in one atomic save", () => {
		const { writes } = markCrawlNotFound(buildArticle(), {
			reason: { kind: "not-found", httpStatus: 404 },
		});

		assert.deepEqual([...writes].sort(), ["crawl", "summary"]);
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

		const { article } = markCrawlNotFound(before, {
			reason: { kind: "not-found", httpStatus: 404 },
		});

		assert.equal(article.metadata.title, "kept title");
		assert.equal(article.freshness.etag, '"kept-etag"');
		assert.equal(article.estimatedReadTime, 3);
	});

	it("does not mutate the input article (pure function)", () => {
		const before = buildArticle();
		const snapshot = JSON.parse(JSON.stringify(before));

		markCrawlNotFound(before, { reason: { kind: "not-found", httpStatus: 404 } });

		assert.deepEqual(before, snapshot);
	});

	it("exposes its function name so transitionAndPersist can tag the row for the Phase 2 canary measurement", () => {
		assert.equal(markCrawlNotFound.name, "markCrawlNotFound");
	});
});
