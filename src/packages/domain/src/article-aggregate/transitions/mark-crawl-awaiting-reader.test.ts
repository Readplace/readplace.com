import assert from "node:assert/strict";
import type { Article } from "../article.types";
import { markCrawlAwaitingReader } from "./mark-crawl-awaiting-reader";

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

describe("markCrawlAwaitingReader", () => {
	it("flips crawl to unsupported with the awaiting-reader reason naming the deferred leg", () => {
		const { article } = markCrawlAwaitingReader(buildArticle(), {
			deferredLeg: "render-residential-per-gb",
		});

		assert.deepEqual(article.crawl, {
			kind: "unsupported",
			reason: { kind: "awaiting-reader", deferredLeg: "render-residential-per-gb" },
		});
	});

	it("flips summary to skipped with reason 'awaiting-reader'", () => {
		const { article } = markCrawlAwaitingReader(buildArticle(), {
			deferredLeg: "comprehensive",
		});

		assert.deepEqual(article.summary, {
			kind: "skipped",
			reason: "awaiting-reader",
		});
	});

	it("emits no effects", () => {
		const { effects } = markCrawlAwaitingReader(buildArticle(), {
			deferredLeg: "content-judge",
		});

		assert.deepEqual(effects, []);
	});

	it("declares writes for crawl and summary so both axes park in one atomic save", () => {
		const { writes } = markCrawlAwaitingReader(buildArticle(), {
			deferredLeg: "comprehensive",
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

		const { article } = markCrawlAwaitingReader(before, {
			deferredLeg: "comprehensive",
		});

		assert.equal(article.metadata.title, "kept title");
		assert.equal(article.freshness.etag, '"kept-etag"');
		assert.equal(article.estimatedReadTime, 3);
	});

	it("does not mutate the input article (pure function)", () => {
		const before = buildArticle();
		const snapshot = JSON.parse(JSON.stringify(before));

		markCrawlAwaitingReader(before, { deferredLeg: "comprehensive" });

		assert.deepEqual(before, snapshot);
	});
});
