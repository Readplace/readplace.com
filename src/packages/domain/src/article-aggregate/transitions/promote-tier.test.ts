import assert from "node:assert/strict";
import type { Article, ArticleMetadata } from "../article.types";
import { CanonicalImageUrlSchema } from "../canonical-image-url";
import { promoteTier, type PromoteTierInput } from "./promote-tier";

/* Helper that brands the imageUrl on test fixtures so they satisfy the
 * transition input's `Omit<ArticleMetadata, "imageUrl"> & { imageUrl:
 * CanonicalImageUrl }` shape. Production code goes through
 * `resolveCanonicalImageUrl` for the same brand. */
function canonicalMetadata(metadata: ArticleMetadata) {
	return { ...metadata, imageUrl: CanonicalImageUrlSchema.parse(metadata.imageUrl) };
}

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
			imageUrl: CanonicalImageUrlSchema.parse("https://example.com/image.jpg"),
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
			buildInput({ metadata: canonicalMetadata(before.metadata), estimatedReadTime: 2 }),
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
			buildInput({ estimatedReadTime: 7, metadata: canonicalMetadata(buildArticle().metadata) }),
		);

		assert.equal(article.estimatedReadTime, 7);
	});

	it("flips crawl to ready", () => {
		const { article } = promoteTier(
			buildArticle(),
			buildInput({ metadata: canonicalMetadata(buildArticle().metadata), estimatedReadTime: 1 }),
		);

		assert.deepEqual(article.crawl, { kind: "ready" });
	});

	it("leaves the summary axis untouched when the canonical hash changed (regeneration is driven by the CanonicalContentChanged subscriber, not this transition)", () => {
		const existingSummary = {
			kind: "ready" as const,
			summary: "existing summary",
			excerpt: "existing excerpt",
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
				metadata: canonicalMetadata(before.metadata),
				estimatedReadTime: 1,
				canonicalContentHash: HASH_B,
			}),
		);

		assert.deepEqual(article.summary, existingSummary);
	});

	it("leaves the cached ready summary untouched when the canonical hash is unchanged", () => {
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
				metadata: canonicalMetadata(before.metadata),
				estimatedReadTime: 1,
				canonicalContentHash: HASH_A,
			}),
		);

		assert.deepEqual(article.summary, existingSummary);
	});

	it("emits publish-canonical-content-changed and publish-crawl-article-completed in that order, plus publish-link-saved when canonicalChanged + userId is supplied", () => {
		const { effects } = promoteTier(
			buildArticle({ url: "https://example.com/post" }),
			buildInput({
				metadata: canonicalMetadata(buildArticle().metadata),
				estimatedReadTime: 1,
				canonicalChanged: true,
				userId: "user-123",
			}),
		);

		assert.deepEqual(effects, [
			{
				kind: "publish-canonical-content-changed",
				url: "https://example.com/post",
			},
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
				metadata: canonicalMetadata(buildArticle().metadata),
				estimatedReadTime: 1,
				canonicalChanged: true,
			}),
		);

		assert.deepEqual(effects, [
			{
				kind: "publish-canonical-content-changed",
				url: "https://example.com/post",
			},
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

	it("emits publish-canonical-content-changed when the canonical tier flipped even though the content hash is unchanged — the incident regression (canonicalChanged=true, contentChanged=false)", () => {
		const stuckSummary = { kind: "skipped" as const, reason: "content-too-short" };
		const before = buildArticle({
			url: "https://example.com/post",
			freshness: {
				etag: '"old-etag"',
				contentFetchedAt: "2026-01-01T00:00:00.000Z",
				canonicalContentHash: HASH_A,
			},
			summary: stuckSummary,
		});

		const { effects, article } = promoteTier(
			before,
			buildInput({
				metadata: canonicalMetadata(before.metadata),
				estimatedReadTime: 1,
				canonicalChanged: true,
				canonicalContentHash: HASH_A,
			}),
		);

		assert.deepEqual(effects, [
			{
				kind: "publish-canonical-content-changed",
				url: "https://example.com/post",
			},
			{
				kind: "publish-crawl-article-completed",
				url: "https://example.com/post",
			},
			{
				kind: "publish-anonymous-link-saved",
				url: "https://example.com/post",
			},
		]);
		/* The transition only announces the change; it must not reset the summary
		 * itself — the subscriber does that. The stuck skipped state is carried
		 * forward unchanged here. */
		assert.deepEqual(article.summary, stuckSummary);
	});

	it("emits publish-canonical-content-changed but omits the user-facing event when the content changed while canonicalChanged is false (same-tier re-pick with different text)", () => {
		const { effects } = promoteTier(
			buildArticle({ url: "https://example.com/post" }),
			buildInput({
				metadata: canonicalMetadata(buildArticle().metadata),
				estimatedReadTime: 1,
				canonicalChanged: false,
				userId: "user-123",
			}),
		);

		assert.deepEqual(effects, [
			{
				kind: "publish-canonical-content-changed",
				url: "https://example.com/post",
			},
			{
				kind: "publish-crawl-article-completed",
				url: "https://example.com/post",
			},
		]);
	});

	it("omits publish-canonical-content-changed when neither the canonical tier nor the content hash changed (re-pick of identical content — no wasted regeneration)", () => {
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
				metadata: canonicalMetadata(before.metadata),
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

	it("treats a missing previous canonicalContentHash as content-changed and announces it (lazy backfill on first run after deploy)", () => {
		const before = buildArticle({
			freshness: {
				etag: '"old-etag"',
				contentFetchedAt: "2026-01-01T00:00:00.000Z",
			},
			summary: { kind: "ready", summary: "kept" },
		});

		const { effects } = promoteTier(
			before,
			buildInput({
				metadata: canonicalMetadata(before.metadata),
				estimatedReadTime: 1,
				canonicalChanged: false,
				canonicalContentHash: HASH_A,
			}),
		);

		assert.ok(
			effects.some((e) => e.kind === "publish-canonical-content-changed"),
		);
	});

	it("declares writes for metadata, freshness, and crawl only — never the summary axis — when the hash changed", () => {
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
				metadata: canonicalMetadata(before.metadata),
				estimatedReadTime: 1,
				canonicalContentHash: HASH_B,
			}),
		);

		assert.deepEqual([...writes].sort(), ["crawl", "freshness", "metadata"]);
	});

	it("declares writes for metadata, freshness, and crawl only when the canonical hash is unchanged", () => {
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
				metadata: canonicalMetadata(before.metadata),
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
				metadata: canonicalMetadata({
					title: "Different",
					siteName: "Example",
					excerpt: "Different",
					wordCount: 200,
				}),
				estimatedReadTime: 3,
			}),
		);

		assert.deepEqual(before, snapshot);
	});

	it("exposes its function name so transitionAndPersist can tag the row for the Phase 2 canary measurement", () => {
		assert.equal(promoteTier.name, "promoteTier");
	});
});
