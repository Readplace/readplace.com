import assert from "node:assert/strict";
import type { Article } from "./article.types";
import { stampReaderAvailability } from "./reader-availability";

const PENDING_SINCE = "2026-01-01T00:00:00.000Z";
const NOW = "2026-06-01T12:00:00.000Z";

function buildArticle(overrides: Partial<Article> = {}): Article {
	return {
		url: "https://example.com/article",
		metadata: { title: "Title", siteName: "Site", excerpt: "Excerpt", wordCount: 100 },
		freshness: { contentFetchedAt: "2026-01-01T00:00:00.000Z" },
		estimatedReadTime: 1,
		crawl: { kind: "pending", pendingSince: PENDING_SINCE },
		summary: { kind: "pending", pendingSince: PENDING_SINCE },
		summaryAutoHeal: { attempts: 0 },
		...overrides,
	};
}

describe("stampReaderAvailability", () => {
	it("records the instant the crawl axis first enters ready", () => {
		const result = stampReaderAvailability({
			article: buildArticle(),
			nextCrawl: { kind: "ready" },
			now: NOW,
		});

		assert.equal(result.article.readerAvailableAt, NOW);
		assert.deepEqual(result.writes, ["readerAvailability"]);
	});

	it("stamps a crawl that recovers from failed, because the body only becomes readable now", () => {
		const result = stampReaderAvailability({
			article: buildArticle({ crawl: { kind: "failed", reason: { kind: "parse-error", detail: "boom" } } }),
			nextCrawl: { kind: "ready" },
			now: NOW,
		});

		assert.equal(result.article.readerAvailableAt, NOW);
		assert.deepEqual(result.writes, ["readerAvailability"]);
	});

	it("keeps the first stamp when an already-available article is re-crawled", () => {
		const first = "2026-05-01T09:00:00.000Z";
		const article = buildArticle({ crawl: { kind: "ready" }, readerAvailableAt: first });

		const result = stampReaderAvailability({ article, nextCrawl: { kind: "ready" }, now: NOW });

		assert.equal(result.article.readerAvailableAt, first);
		assert.deepEqual(result.writes, []);
	});

	it("does not re-stamp an article already ready but never stamped, so a recrawl cannot invent a later instant", () => {
		const article = buildArticle({ crawl: { kind: "ready" } });

		const result = stampReaderAvailability({ article, nextCrawl: { kind: "ready" }, now: NOW });

		assert.equal(result.article.readerAvailableAt, undefined);
		assert.deepEqual(result.writes, []);
	});

	it("leaves an unstamped article alone when the crawl does not reach ready", () => {
		const article = buildArticle();

		const result = stampReaderAvailability({
			article,
			nextCrawl: { kind: "pending", pendingSince: PENDING_SINCE },
			now: NOW,
		});

		assert.equal(result.article, article);
		assert.deepEqual(result.writes, []);
	});
});
