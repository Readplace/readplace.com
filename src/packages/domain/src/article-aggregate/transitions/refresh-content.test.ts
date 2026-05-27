import assert from "node:assert/strict";
import type { Article } from "../article.types";
import { CanonicalImageUrlSchema } from "../canonical-image-url";
import { refreshContent, type RefreshContentInput } from "./refresh-content";

const NOW = "2026-05-13T12:00:00.000Z";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

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
		summaryAutoHeal: { attempts: 0 },
		...overrides,
	};
}

function buildInput(overrides: Omit<Partial<RefreshContentInput>, "metadata"> = {}): RefreshContentInput {
	return {
		metadata: {
			title: "New title",
			siteName: "Example",
			excerpt: "New excerpt",
			wordCount: 250,
			imageUrl: CanonicalImageUrlSchema.parse("https://example.com/image.jpg"),
		},
		freshness: {
			etag: '"new-etag"',
			contentFetchedAt: "2026-05-10T12:00:00.000Z",
		},
		estimatedReadTime: 2,
		now: NOW,
		canonicalContentHash: HASH_A,
		...overrides,
	};
}

describe("refreshContent", () => {
	it("overwrites metadata, freshness, and estimated read time with the fetched values", () => {
		const before = buildArticle();

		const { article } = refreshContent(before, {
			metadata: {
				title: "New title",
				siteName: "Example",
				excerpt: "New excerpt",
				wordCount: 250,
				imageUrl: CanonicalImageUrlSchema.parse("https://example.com/image.jpg"),
			},
			freshness: {
				etag: '"new-etag"',
				lastModified: "Sun, 10 May 2026 12:00:00 GMT",
				contentFetchedAt: "2026-05-10T12:00:00.000Z",
			},
			estimatedReadTime: 2,
			now: NOW,
			canonicalContentHash: HASH_A,
		});

		assert.equal(article.metadata.title, "New title");
		assert.equal(article.metadata.wordCount, 250);
		assert.equal(article.metadata.imageUrl, "https://example.com/image.jpg");
		assert.equal(article.freshness.etag, '"new-etag"');
		assert.equal(article.freshness.contentFetchedAt, "2026-05-10T12:00:00.000Z");
		assert.equal(article.estimatedReadTime, 2);
	});

	it("writes the new canonicalContentHash onto freshness so subsequent runs can compare against it", () => {
		const before = buildArticle();

		const { article } = refreshContent(before, buildInput());

		assert.equal(article.freshness.canonicalContentHash, HASH_A);
	});

	it("resets summary to pending when the canonical hash changed so the worker regenerates the cached text", () => {
		const before = buildArticle({
			freshness: {
				etag: '"old-etag"',
				lastModified: "Thu, 01 Jan 2026 00:00:00 GMT",
				contentFetchedAt: "2026-01-01T00:00:00.000Z",
				canonicalContentHash: HASH_A,
			},
			summary: {
				kind: "ready",
				summary: "stale summary",
				excerpt: "stale excerpt",
				inputTokens: 1234,
				outputTokens: 567,
			},
		});

		const { article } = refreshContent(before, buildInput({
			canonicalContentHash: HASH_B,
		}));

		assert.deepEqual(article.summary, { kind: "pending", pendingSince: NOW });
	});

	it("preserves the cached ready summary when the canonical hash is unchanged (cacheability gate prevents wasted regeneration)", () => {
		const existingSummary = {
			kind: "ready" as const,
			summary: "kept summary",
			excerpt: "kept excerpt",
		};
		const before = buildArticle({
			freshness: {
				etag: '"old-etag"',
				lastModified: "Thu, 01 Jan 2026 00:00:00 GMT",
				contentFetchedAt: "2026-01-01T00:00:00.000Z",
				canonicalContentHash: HASH_A,
			},
			summary: existingSummary,
		});

		const { article } = refreshContent(before, buildInput());

		assert.deepEqual(article.summary, existingSummary);
	});

	it("treats a missing previous canonicalContentHash as content-changed (lazy backfill on first run after deploy)", () => {
		const before = buildArticle({
			summary: { kind: "ready", summary: "stale" },
		});

		const { article, writes } = refreshContent(before, buildInput());

		assert.deepEqual(article.summary, { kind: "pending", pendingSince: NOW });
		assert.ok(writes.includes("summary"));
	});

	it("stamps pendingSince with the provided now so the canary can age-gate the row", () => {
		const before = buildArticle({
			freshness: {
				etag: '"old-etag"',
				lastModified: "Thu, 01 Jan 2026 00:00:00 GMT",
				contentFetchedAt: "2026-01-01T00:00:00.000Z",
				canonicalContentHash: HASH_A,
			},
		});

		const { article } = refreshContent(before, buildInput({
			canonicalContentHash: HASH_B,
		}));

		assert.equal(
			article.summary.kind === "pending" ? article.summary.pendingSince : "",
			NOW,
		);
	});

	it("preserves crawl state so a successful refresh does not regress the crawl row", () => {
		const before = buildArticle({ crawl: { kind: "ready" } });

		const { article } = refreshContent(before, buildInput());

		assert.deepEqual(article.crawl, { kind: "ready" });
	});

	it("emits a generate-summary effect when canonical hash changed", () => {
		const before = buildArticle({
			url: "https://example.com/post",
			freshness: {
				etag: '"old-etag"',
				lastModified: "Thu, 01 Jan 2026 00:00:00 GMT",
				contentFetchedAt: "2026-01-01T00:00:00.000Z",
				canonicalContentHash: HASH_A,
			},
		});

		const { effects } = refreshContent(before, buildInput({
			canonicalContentHash: HASH_B,
		}));

		assert.deepEqual(effects, [
			{ kind: "generate-summary", url: "https://example.com/post" },
		]);
	});

	it("emits no effects when canonical hash is unchanged (refresh that produced identical content must not regenerate)", () => {
		const before = buildArticle({
			url: "https://example.com/post",
			freshness: {
				etag: '"old-etag"',
				lastModified: "Thu, 01 Jan 2026 00:00:00 GMT",
				contentFetchedAt: "2026-01-01T00:00:00.000Z",
				canonicalContentHash: HASH_A,
			},
			summary: { kind: "ready", summary: "kept" },
		});

		const { effects } = refreshContent(before, buildInput());

		assert.deepEqual(effects, []);
	});

	it("declares writes for metadata, freshness, and summary when hash changed (crawl stays untouched while in ready state)", () => {
		const before = buildArticle({
			freshness: {
				etag: '"old-etag"',
				lastModified: "Thu, 01 Jan 2026 00:00:00 GMT",
				contentFetchedAt: "2026-01-01T00:00:00.000Z",
				canonicalContentHash: HASH_A,
			},
		});

		const { writes } = refreshContent(before, buildInput({
			canonicalContentHash: HASH_B,
		}));

		assert.deepEqual([...writes].sort(), ["freshness", "metadata", "summary"]);
		assert.ok(!writes.includes("crawl"), "refresh must not clobber an in-flight or already-ready crawl");
	});

	it("declares writes for metadata and freshness only (no summary) when canonical hash is unchanged", () => {
		const before = buildArticle({
			freshness: {
				etag: '"old-etag"',
				lastModified: "Thu, 01 Jan 2026 00:00:00 GMT",
				contentFetchedAt: "2026-01-01T00:00:00.000Z",
				canonicalContentHash: HASH_A,
			},
			summary: { kind: "ready", summary: "kept" },
		});

		const { writes } = refreshContent(before, buildInput());

		assert.deepEqual([...writes].sort(), ["freshness", "metadata"]);
		assert.ok(!writes.includes("summary"));
		assert.ok(!writes.includes("crawl"));
	});

	it("promotes crawl to ready when the previous state was failed (recovery: refresh delivered fresh content for a previously-stuck row)", () => {
		const before = buildArticle({
			crawl: { kind: "failed", reason: { kind: "fetch-failed", httpStatus: 503 } },
		});

		const { article, writes } = refreshContent(before, {
			metadata: before.metadata,
			freshness: before.freshness,
			estimatedReadTime: before.estimatedReadTime,
			now: NOW,
			canonicalContentHash: HASH_A,
		});

		assert.deepEqual(article.crawl, { kind: "ready" });
		assert.ok(writes.includes("crawl"), "recovery-from-failed must declare a crawl write");
	});

	it("does not declare a crawl write when the previous state was pending (avoids racing an in-flight crawl)", () => {
		const before = buildArticle({
			crawl: { kind: "pending", pendingSince: "2026-01-01T00:00:00.000Z" },
		});

		const { article, writes } = refreshContent(before, {
			metadata: before.metadata,
			freshness: before.freshness,
			estimatedReadTime: before.estimatedReadTime,
			now: NOW,
			canonicalContentHash: HASH_A,
		});

		assert.deepEqual(article.crawl, before.crawl);
		assert.ok(!writes.includes("crawl"), "refresh must not write crawl when an inline crawl is in flight");
	});

	it("does not declare a crawl write when the previous state was unsupported (no recovery from policy decisions)", () => {
		const before = buildArticle({
			crawl: { kind: "unsupported", reason: { kind: "paywall" } },
		});

		const { article, writes } = refreshContent(before, {
			metadata: before.metadata,
			freshness: before.freshness,
			estimatedReadTime: before.estimatedReadTime,
			now: NOW,
			canonicalContentHash: HASH_A,
		});

		assert.deepEqual(article.crawl, before.crawl);
		assert.ok(!writes.includes("crawl"));
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
				imageUrl: CanonicalImageUrlSchema.parse(undefined),
			},
			freshness: {
				etag: '"different"',
				contentFetchedAt: "2026-05-10T12:00:00.000Z",
			},
			estimatedReadTime: 3,
			now: NOW,
			canonicalContentHash: HASH_A,
		});

		assert.deepEqual(before, beforeSnapshot);
	});
});
