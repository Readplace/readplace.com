import assert from "node:assert/strict";
import type { Article } from "../article.types";
import { markCrawlExhausted } from "./mark-crawl-exhausted";

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

describe("markCrawlExhausted", () => {
	it("flips crawl to failed with the supplied tagged-union reason", () => {
		const { article } = markCrawlExhausted(buildArticle(), {
			reason: { kind: "exhausted-retries", receiveCount: 4 },
			receiveCount: 4,
		});

		assert.deepEqual(article.crawl, {
			kind: "failed",
			reason: { kind: "exhausted-retries", receiveCount: 4 },
		});
	});

	it("flips summary to failed with kind=crawl-failed (the cross-axis pairing the four DLQ handlers used to inline)", () => {
		const { article } = markCrawlExhausted(buildArticle(), {
			reason: { kind: "exhausted-retries", receiveCount: 4 },
			receiveCount: 4,
		});

		assert.deepEqual(article.summary, {
			kind: "failed",
			reason: { kind: "crawl-failed" },
		});
	});

	it("emits a publish-crawl-article-failed effect carrying the url, a stringified reason, and receiveCount", () => {
		const { effects } = markCrawlExhausted(
			buildArticle({ url: "https://example.com/post" }),
			{ reason: { kind: "exhausted-retries", receiveCount: 7 }, receiveCount: 7 },
		);

		assert.deepEqual(effects, [
			{
				kind: "publish-crawl-article-failed",
				url: "https://example.com/post",
				reason: "exhausted-retries (receiveCount=7)",
				receiveCount: 7,
			},
		]);
	});

	it("declares writes for crawl and summary so the aggregate save scopes to the two axes the transition mutated", () => {
		const { writes } = markCrawlExhausted(buildArticle(), {
			reason: { kind: "exhausted-retries", receiveCount: 1 },
			receiveCount: 1,
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

		const { article } = markCrawlExhausted(before, {
			reason: { kind: "exhausted-retries", receiveCount: 1 },
			receiveCount: 1,
		});

		assert.equal(article.metadata.title, "kept title");
		assert.equal(article.freshness.etag, '"kept-etag"');
		assert.equal(article.estimatedReadTime, 3);
	});

	it("does not mutate the input article (pure function)", () => {
		const before = buildArticle();
		const snapshot = JSON.parse(JSON.stringify(before));

		markCrawlExhausted(before, {
			reason: { kind: "exhausted-retries", receiveCount: 1 },
			receiveCount: 1,
		});

		assert.deepEqual(before, snapshot);
	});

	it("stringifies parse-error reasons for the publish-crawl-article-failed effect", () => {
		const { effects } = markCrawlExhausted(buildArticle(), {
			reason: { kind: "parse-error", detail: "missing <article>" },
			receiveCount: 1,
		});

		const failed = effects[0];
		assert.ok(failed && failed.kind === "publish-crawl-article-failed");
		assert.equal(failed.reason, "parse-error: missing <article>");
	});

	it("stringifies fetch-failed reasons with and without httpStatus", () => {
		const { effects: withStatus } = markCrawlExhausted(buildArticle(), {
			reason: { kind: "fetch-failed", httpStatus: 503 },
			receiveCount: 1,
		});
		const withStatusEffect = withStatus[0];
		assert.ok(
			withStatusEffect &&
				withStatusEffect.kind === "publish-crawl-article-failed",
		);
		assert.equal(withStatusEffect.reason, "fetch-failed: HTTP 503");

		const { effects: withoutStatus } = markCrawlExhausted(buildArticle(), {
			reason: { kind: "fetch-failed" },
			receiveCount: 1,
		});
		const withoutStatusEffect = withoutStatus[0];
		assert.ok(
			withoutStatusEffect &&
				withoutStatusEffect.kind === "publish-crawl-article-failed",
		);
		assert.equal(withoutStatusEffect.reason, "fetch-failed");
	});

	it("stringifies blocked reasons with cause", () => {
		const { effects } = markCrawlExhausted(buildArticle(), {
			reason: { kind: "blocked", cause: "cloudflare" },
			receiveCount: 1,
		});
		const failed = effects[0];
		assert.ok(failed && failed.kind === "publish-crawl-article-failed");
		assert.equal(failed.reason, "blocked: cloudflare");
	});

	it("exposes its function name so transitionAndPersist can tag the row for the Phase 2 canary measurement", () => {
		assert.equal(markCrawlExhausted.name, "markCrawlExhausted");
	});
});
