import assert from "node:assert/strict";
import type { Article } from "../article.types";
import { promoteTier, type PromoteTierInput } from "./promote-tier";

const FIXED_PENDING = "2026-01-01T00:00:00.000Z";
const NOW = "2026-05-13T12:00:00.000Z";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function buildArticle(overrides: Partial<Article> = {}): Article {
	return {
		url: "https://example.com/article",
		metadata: {
			title: "Old title",
			siteName: "Old site",
			excerpt: "Old excerpt",
			wordCount: 100,
		},
		freshness: {
			etag: '"old-etag"',
			contentFetchedAt: "2026-01-01T00:00:00.000Z",
		},
		estimatedReadTime: 1,
		crawl: { kind: "pending", pendingSince: FIXED_PENDING },
		summary: { kind: "pending", pendingSince: FIXED_PENDING },
		summaryAutoHeal: { attempts: 0 },
		...overrides,
	};
}

function buildInput(overrides: Partial<PromoteTierInput> = {}): PromoteTierInput {
	return {
		tier: "tier-0",
		metadata: {
			title: "New title",
			siteName: "New site",
			excerpt: "New excerpt",
			wordCount: 250,
			imageUrl: "https://example.com/image.jpg",
		},
		estimatedReadTime: 2,
		contentFetchedAt: "2026-05-10T12:00:00.000Z",
		now: NOW,
		canonicalChanged: true,
		canonicalContentHash: HASH_A,
		...overrides,
	};
}

describe("promoteTier", () => {
	it("overwrites metadata with the supplied values", () => {
		const { article } = promoteTier(buildArticle(), buildInput());

		assert.equal(article.metadata.title, "New title");
		assert.equal(article.metadata.wordCount, 250);
		assert.equal(article.metadata.imageUrl, "https://example.com/image.jpg");
	});

	it("updates contentFetchedAt on freshness while preserving other freshness attributes (etag, lastModified)", () => {
		const before = buildArticle({
			freshness: {
				etag: '"kept-etag"',
				lastModified: "Thu, 01 Jan 2026 00:00:00 GMT",
				contentFetchedAt: "2026-01-01T00:00:00.000Z",
			},
		});

		const { article } = promoteTier(
			before,
			buildInput({ metadata: before.metadata, estimatedReadTime: 2 }),
		);

		assert.equal(article.freshness.contentFetchedAt, "2026-05-10T12:00:00.000Z");
		assert.equal(article.freshness.etag, '"kept-etag"');
		assert.equal(article.freshness.lastModified, "Thu, 01 Jan 2026 00:00:00 GMT");
	});

	it("writes the new canonicalContentHash onto freshness so subsequent runs can compare against it", () => {
		const { article } = promoteTier(
			buildArticle(),
			buildInput({ canonicalContentHash: HASH_A }),
		);

		assert.equal(article.freshness.canonicalContentHash, HASH_A);
	});

	it("overwrites estimatedReadTime with the supplied value", () => {
		const { article } = promoteTier(
			buildArticle(),
			buildInput({ estimatedReadTime: 7, metadata: buildArticle().metadata }),
		);

		assert.equal(article.estimatedReadTime, 7);
	});

	it("flips crawl to ready", () => {
		const { article } = promoteTier(
			buildArticle(),
			buildInput({ metadata: buildArticle().metadata, estimatedReadTime: 1 }),
		);

		assert.deepEqual(article.crawl, { kind: "ready" });
	});

	it("resets summary to pending when the canonical hash changed so the worker regenerates against the new canonical", () => {
		const before = buildArticle({
			freshness: {
				etag: '"old-etag"',
				contentFetchedAt: "2026-01-01T00:00:00.000Z",
				canonicalContentHash: HASH_A,
			},
			summary: {
				kind: "ready",
				summary: "stale summary",
				excerpt: "stale excerpt",
			},
		});

		const { article } = promoteTier(
			before,
			buildInput({
				metadata: before.metadata,
				estimatedReadTime: 1,
				canonicalContentHash: HASH_B,
			}),
		);

		assert.deepEqual(article.summary, { kind: "pending", pendingSince: NOW });
	});

	it("preserves the cached ready summary when the canonical hash is unchanged (cacheability gate)", () => {
		const existingSummary = {
			kind: "ready" as const,
			summary: "cached summary",
			excerpt: "cached excerpt",
		};
		const before = buildArticle({
			freshness: {
				etag: '"old-etag"',
				contentFetchedAt: "2026-01-01T00:00:00.000Z",
				canonicalContentHash: HASH_A,
			},
			summary: existingSummary,
		});

		const { article } = promoteTier(
			before,
			buildInput({
				metadata: before.metadata,
				estimatedReadTime: 1,
				canonicalContentHash: HASH_A,
			}),
		);

		assert.deepEqual(article.summary, existingSummary);
	});

	it("treats a missing previous canonicalContentHash as content-changed (lazy backfill on first run after deploy)", () => {
		const before = buildArticle({
			freshness: {
				etag: '"old-etag"',
				contentFetchedAt: "2026-01-01T00:00:00.000Z",
			},
			summary: { kind: "ready", summary: "stale" },
		});

		const { article, writes } = promoteTier(
			before,
			buildInput({
				metadata: before.metadata,
				estimatedReadTime: 1,
				canonicalContentHash: HASH_A,
			}),
		);

		assert.deepEqual(article.summary, { kind: "pending", pendingSince: NOW });
		assert.ok(writes.includes("summary"));
	});

	it("stamps pendingSince with the provided now so the canary can age-gate the summary axis", () => {
		const before = buildArticle({
			freshness: {
				etag: '"old-etag"',
				contentFetchedAt: "2026-01-01T00:00:00.000Z",
				canonicalContentHash: HASH_A,
			},
		});

		const { article } = promoteTier(
			before,
			buildInput({
				metadata: before.metadata,
				estimatedReadTime: 1,
				canonicalContentHash: HASH_B,
			}),
		);

		assert.equal(
			article.summary.kind === "pending" ? article.summary.pendingSince : "",
			NOW,
		);
	});

	it("emits generate-summary and publish-crawl-article-completed in that order, plus publish-link-saved when canonicalChanged + userId is supplied", () => {
		const { effects } = promoteTier(
			buildArticle({ url: "https://example.com/post" }),
			buildInput({
				metadata: buildArticle().metadata,
				estimatedReadTime: 1,
				canonicalChanged: true,
				userId: "user-123",
			}),
		);

		assert.deepEqual(effects, [
			{ kind: "generate-summary", url: "https://example.com/post" },
			{
				kind: "publish-crawl-article-completed",
				url: "https://example.com/post",
			},
			{
				kind: "publish-link-saved",
				url: "https://example.com/post",
				userId: "user-123",
			},
		]);
	});

	it("emits publish-anonymous-link-saved when canonicalChanged is true and userId is absent", () => {
		const { effects } = promoteTier(
			buildArticle({ url: "https://example.com/post" }),
			buildInput({
				metadata: buildArticle().metadata,
				estimatedReadTime: 1,
				canonicalChanged: true,
			}),
		);

		assert.deepEqual(effects, [
			{ kind: "generate-summary", url: "https://example.com/post" },
			{
				kind: "publish-crawl-article-completed",
				url: "https://example.com/post",
			},
			{
				kind: "publish-anonymous-link-saved",
				url: "https://example.com/post",
			},
		]);
	});

	it("omits the user-facing event when canonicalChanged is false (re-pick of the same tier must not re-fire link-saved notifications)", () => {
		const { effects } = promoteTier(
			buildArticle({ url: "https://example.com/post" }),
			buildInput({
				metadata: buildArticle().metadata,
				estimatedReadTime: 1,
				canonicalChanged: false,
				userId: "user-123",
			}),
		);

		assert.deepEqual(effects, [
			{ kind: "generate-summary", url: "https://example.com/post" },
			{
				kind: "publish-crawl-article-completed",
				url: "https://example.com/post",
			},
		]);
	});

	it("omits the generate-summary effect when canonical hash is unchanged (cacheability gate prevents wasted DeepSeek tokens)", () => {
		const before = buildArticle({
			url: "https://example.com/post",
			freshness: {
				etag: '"old-etag"',
				contentFetchedAt: "2026-01-01T00:00:00.000Z",
				canonicalContentHash: HASH_A,
			},
			summary: { kind: "ready", summary: "kept" },
		});

		const { effects } = promoteTier(
			before,
			buildInput({
				metadata: before.metadata,
				estimatedReadTime: 1,
				canonicalChanged: false,
				canonicalContentHash: HASH_A,
				userId: "user-123",
			}),
		);

		assert.deepEqual(effects, [
			{
				kind: "publish-crawl-article-completed",
				url: "https://example.com/post",
			},
		]);
	});

	it("declares writes for metadata, freshness, crawl, and summary when the hash changed so the aggregate save scopes to the four mutated axes", () => {
		const before = buildArticle({
			freshness: {
				etag: '"old-etag"',
				contentFetchedAt: "2026-01-01T00:00:00.000Z",
				canonicalContentHash: HASH_A,
			},
		});

		const { writes } = promoteTier(
			before,
			buildInput({
				metadata: before.metadata,
				estimatedReadTime: 1,
				canonicalContentHash: HASH_B,
			}),
		);

		assert.deepEqual([...writes].sort(), [
			"crawl",
			"freshness",
			"metadata",
			"summary",
		]);
	});

	it("declares writes for metadata, freshness, and crawl only (no summary) when the canonical hash is unchanged", () => {
		const before = buildArticle({
			freshness: {
				etag: '"old-etag"',
				contentFetchedAt: "2026-01-01T00:00:00.000Z",
				canonicalContentHash: HASH_A,
			},
			summary: { kind: "ready", summary: "kept" },
		});

		const { writes } = promoteTier(
			before,
			buildInput({
				metadata: before.metadata,
				estimatedReadTime: 1,
				canonicalContentHash: HASH_A,
			}),
		);

		assert.deepEqual([...writes].sort(), ["crawl", "freshness", "metadata"]);
	});

	it("does not mutate the input article (pure function)", () => {
		const before = buildArticle();
		const snapshot = JSON.parse(JSON.stringify(before));

		promoteTier(
			before,
			buildInput({
				tier: "tier-1",
				metadata: {
					title: "Different",
					siteName: "Example",
					excerpt: "Different",
					wordCount: 200,
				},
				estimatedReadTime: 3,
			}),
		);

		assert.deepEqual(before, snapshot);
	});

	it("exposes its function name so transitionAndPersist can tag the row for the Phase 2 canary measurement", () => {
		assert.equal(promoteTier.name, "promoteTier");
	});
});
