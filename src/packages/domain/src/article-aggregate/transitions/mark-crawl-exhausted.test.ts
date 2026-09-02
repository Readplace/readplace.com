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

	it("stringifies exhausted-retries as a bare label, keeping receiveCount only in the structured effect field so a future crawl parse-error sink could not double it (mirrors the summary axis)", () => {
		const { effects } = markCrawlExhausted(
			buildArticle({ url: "https://example.com/post" }),
			{ reason: { kind: "exhausted-retries", receiveCount: 7 }, receiveCount: 7 },
		);

		assert.deepEqual(effects, [
			{
				kind: "publish-crawl-article-failed",
				url: "https://example.com/post",
				reason: "exhausted-retries",
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
			reason: { kind: "blocked", cause: "edge-block" },
			receiveCount: 1,
		});
		const failed = effects[0];
		assert.ok(failed && failed.kind === "publish-crawl-article-failed");
		assert.equal(failed.reason, "blocked: edge-block");
	});

	it("stringifies not-found reasons with the httpStatus", () => {
		const { effects } = markCrawlExhausted(buildArticle(), {
			reason: { kind: "not-found", httpStatus: 404 },
			receiveCount: 1,
		});
		const failed = effects[0];
		assert.ok(failed && failed.kind === "publish-crawl-article-failed");
		assert.equal(failed.reason, "not-found: HTTP 404");
	});

	it("stringifies origin-unreachable with httpStatus, with code, and bare", () => {
		const { effects: withStatus } = markCrawlExhausted(buildArticle(), {
			reason: { kind: "origin-unreachable", httpStatus: 522 },
			receiveCount: 1,
		});
		const withStatusEffect = withStatus[0];
		assert.ok(
			withStatusEffect &&
				withStatusEffect.kind === "publish-crawl-article-failed",
		);
		assert.equal(withStatusEffect.reason, "origin-unreachable: HTTP 522");

		const { effects: withCode } = markCrawlExhausted(buildArticle(), {
			reason: { kind: "origin-unreachable", code: "ENOTFOUND" },
			receiveCount: 1,
		});
		const withCodeEffect = withCode[0];
		assert.ok(
			withCodeEffect && withCodeEffect.kind === "publish-crawl-article-failed",
		);
		assert.equal(withCodeEffect.reason, "origin-unreachable: ENOTFOUND");

		const { effects: bare } = markCrawlExhausted(buildArticle(), {
			reason: { kind: "origin-unreachable" },
			receiveCount: 1,
		});
		const bareEffect = bare[0];
		assert.ok(bareEffect && bareEffect.kind === "publish-crawl-article-failed");
		assert.equal(bareEffect.reason, "origin-unreachable");
	});

	it("keeps the reason a prior inline markCrawlFailed persisted instead of clobbering it with the retry label", () => {
		const alreadyFailed = buildArticle({
			crawl: {
				kind: "failed",
				reason: { kind: "origin-unreachable", httpStatus: 522 },
			},
		});

		const { article } = markCrawlExhausted(alreadyFailed, {
			reason: { kind: "exhausted-retries", receiveCount: 2 },
			receiveCount: 2,
		});

		assert.deepEqual(article.crawl, {
			kind: "failed",
			reason: { kind: "origin-unreachable", httpStatus: 522 },
		});
	});

	it("writes only the summary axis when the crawl axis already carries its failure reason", () => {
		const alreadyFailed = buildArticle({
			crawl: {
				kind: "failed",
				reason: { kind: "origin-unreachable", httpStatus: 522 },
			},
		});

		const { writes, article } = markCrawlExhausted(alreadyFailed, {
			reason: { kind: "exhausted-retries", receiveCount: 2 },
			receiveCount: 2,
		});

		assert.deepEqual(writes, ["summary"]);
		assert.deepEqual(article.summary, {
			kind: "failed",
			reason: { kind: "crawl-failed" },
		});
	});

	it("emits publish-crawl-article-failed with the kept reason's string, not the retry label", () => {
		const alreadyFailed = buildArticle({
			crawl: {
				kind: "failed",
				reason: { kind: "origin-unreachable", httpStatus: 522 },
			},
		});

		const { effects } = markCrawlExhausted(alreadyFailed, {
			reason: { kind: "exhausted-retries", receiveCount: 2 },
			receiveCount: 2,
		});

		const failed = effects[0];
		assert.ok(failed && failed.kind === "publish-crawl-article-failed");
		assert.equal(failed.reason, "origin-unreachable: HTTP 522");
	});

	it("declares no writes when both axes are already terminal, so a redelivered DLQ record is a pure re-announcement", () => {
		const bothTerminal = buildArticle({
			crawl: { kind: "failed", reason: { kind: "fetch-failed" } },
			summary: { kind: "failed", reason: { kind: "crawl-failed" } },
		});

		const { writes, effects } = markCrawlExhausted(bothTerminal, {
			reason: { kind: "exhausted-retries", receiveCount: 3 },
			receiveCount: 3,
		});

		assert.deepEqual(writes, []);
		assert.equal(effects.length, 1);
	});

	it("does not resurrect a summary another path already terminalised (skipped stays skipped)", () => {
		const skippedSummary = buildArticle({
			summary: { kind: "skipped", reason: "crawl-failed" },
		});

		const { writes, article } = markCrawlExhausted(skippedSummary, {
			reason: { kind: "exhausted-retries", receiveCount: 1 },
			receiveCount: 1,
		});

		assert.deepEqual(writes, ["crawl"]);
		assert.deepEqual(article.summary, { kind: "skipped", reason: "crawl-failed" });
	});

	it("leaves an unsupported crawl verdict in place and only terminalises the pending summary", () => {
		const unsupported = buildArticle({
			crawl: {
				kind: "unsupported",
				reason: { kind: "non-html-content", contentType: "image/png" },
			},
		});

		const { writes, article } = markCrawlExhausted(unsupported, {
			reason: { kind: "exhausted-retries", receiveCount: 1 },
			receiveCount: 1,
		});

		assert.deepEqual(writes, ["summary"]);
		assert.deepEqual(article.crawl, {
			kind: "unsupported",
			reason: { kind: "non-html-content", contentType: "image/png" },
		});
		assert.deepEqual(article.summary, {
			kind: "failed",
			reason: { kind: "crawl-failed" },
		});
	});

	it("exposes its function name so transitionAndPersist can tag the row for the Phase 2 canary measurement", () => {
		assert.equal(markCrawlExhausted.name, "markCrawlExhausted");
	});

	it("no-ops (empty writes and effects) when crawl is already ready, so a stale dead-lettered retry cannot clobber a row another path healed", () => {
		const healed = buildArticle({
			crawl: { kind: "ready" },
			summary: { kind: "ready", summary: "already generated" },
		});

		const { article, effects, writes } = markCrawlExhausted(healed, {
			reason: { kind: "exhausted-retries", receiveCount: 4 },
			receiveCount: 4,
		});

		assert.deepEqual(writes, []);
		assert.deepEqual(effects, []);
		assert.deepEqual(article.crawl, { kind: "ready" });
		assert.deepEqual(article.summary, {
			kind: "ready",
			summary: "already generated",
		});
	});
});
