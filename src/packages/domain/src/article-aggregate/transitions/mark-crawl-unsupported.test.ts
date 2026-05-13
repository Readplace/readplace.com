import assert from "node:assert/strict";
import type { Article } from "../article.types";
import { markCrawlUnsupported } from "./mark-crawl-unsupported";

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

describe("markCrawlUnsupported", () => {
	it("flips crawl to unsupported with the supplied reason", () => {
		const { article } = markCrawlUnsupported(buildArticle(), {
			reason: { kind: "non-html-content", contentType: "application/pdf" },
		});

		assert.deepEqual(article.crawl, {
			kind: "unsupported",
			reason: { kind: "non-html-content", contentType: "application/pdf" },
		});
	});

	it("flips summary to skipped with reason 'crawl-unsupported' so the summary canary doesn't keep flagging the row", () => {
		const { article } = markCrawlUnsupported(buildArticle(), {
			reason: { kind: "non-html-content", contentType: "application/pdf" },
		});

		assert.deepEqual(article.summary, {
			kind: "skipped",
			reason: "crawl-unsupported",
		});
	});

	it("emits no effects (terminal status write only)", () => {
		const { effects } = markCrawlUnsupported(buildArticle(), {
			reason: { kind: "non-html-content", contentType: "application/pdf" },
		});

		assert.deepEqual(effects, []);
	});

	it("declares writes for crawl and summary so the aggregate save scopes to the two axes the transition mutated", () => {
		const { writes } = markCrawlUnsupported(buildArticle(), {
			reason: { kind: "non-html-content", contentType: "application/pdf" },
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

		const { article } = markCrawlUnsupported(before, {
			reason: { kind: "non-html-content", contentType: "application/pdf" },
		});

		assert.equal(article.metadata.title, "kept title");
		assert.equal(article.freshness.etag, '"kept-etag"');
		assert.equal(article.estimatedReadTime, 3);
	});

	it("does not mutate the input article (pure function)", () => {
		const before = buildArticle();
		const snapshot = JSON.parse(JSON.stringify(before));

		markCrawlUnsupported(before, { reason: { kind: "non-html-content", contentType: "application/pdf" } });

		assert.deepEqual(before, snapshot);
	});

	it("exposes its function name so transitionAndPersist can tag the row for the Phase 2 canary measurement", () => {
		assert.equal(markCrawlUnsupported.name, "markCrawlUnsupported");
	});
});
