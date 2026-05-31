import assert from "node:assert/strict";
import type { Article } from "../article.types";
import { CanonicalImageUrlSchema } from "../canonical-image-url";
import {
	recrawlPromoteTier,
	type RecrawlPromoteTierInput,
} from "./recrawl-promote-tier";

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
			lastModified: "Thu, 01 Jan 2026 00:00:00 GMT",
			contentFetchedAt: "2026-01-01T00:00:00.000Z",
		},
		estimatedReadTime: 1,
		crawl: { kind: "pending", pendingSince: FIXED_PENDING },
		summary: { kind: "ready", summary: "old" },
		summaryAutoHeal: { attempts: 0 },
		...overrides,
	};
}

function buildInput(overrides: Partial<RecrawlPromoteTierInput> = {}): RecrawlPromoteTierInput {
	return {
		winnerTier: "tier-1",
		metadata: {
			title: "New title",
			siteName: "New site",
			excerpt: "New excerpt",
			wordCount: 250,
			imageUrl: CanonicalImageUrlSchema.parse("https://example.com/image.jpg"),
		},
		estimatedReadTime: 3,
		contentFetchedAt: "2026-05-10T12:00:00.000Z",
		now: NOW,
		canonicalContentHash: HASH_A,
		...overrides,
	};
}

describe("recrawlPromoteTier", () => {
	it("flips crawl from pending to ready after a tier promotion", () => {
		const { article } = recrawlPromoteTier(buildArticle(), buildInput());

		assert.deepEqual(article.crawl, { kind: "ready" });
	});

	it("writes the incoming metadata onto the article (refreshing title/excerpt/wordCount/imageUrl on every recrawl)", () => {
		const { article } = recrawlPromoteTier(
			buildArticle(),
			buildInput({
				metadata: {
					title: "Refreshed title",
					siteName: "Refreshed site",
					excerpt: "Refreshed excerpt",
					wordCount: 999,
					imageUrl: CanonicalImageUrlSchema.parse("https://example.com/refreshed.jpg"),
				},
			}),
		);

		assert.equal(article.metadata.title, "Refreshed title");
		assert.equal(article.metadata.siteName, "Refreshed site");
		assert.equal(article.metadata.excerpt, "Refreshed excerpt");
		assert.equal(article.metadata.wordCount, 999);
		assert.equal(article.metadata.imageUrl, "https://example.com/refreshed.jpg");
	});

	it("writes the incoming contentFetchedAt onto article.freshness, preserving other freshness fields (etag/lastModified)", () => {
		const before = buildArticle({
			freshness: {
				etag: '"kept-etag"',
				lastModified: "Thu, 01 Jan 2026 00:00:00 GMT",
				contentFetchedAt: "2026-01-01T00:00:00.000Z",
			},
		});

		const { article } = recrawlPromoteTier(
			before,
			buildInput({ contentFetchedAt: "2026-05-10T12:00:00.000Z" }),
		);

		assert.equal(article.freshness.contentFetchedAt, "2026-05-10T12:00:00.000Z");
		assert.equal(article.freshness.etag, '"kept-etag"');
		assert.equal(article.freshness.lastModified, "Thu, 01 Jan 2026 00:00:00 GMT");
	});

	it("writes the new canonicalContentHash onto freshness so non-operator paths can compare against it", () => {
		const { article } = recrawlPromoteTier(
			buildArticle(),
			buildInput({ canonicalContentHash: HASH_A }),
		);

		assert.equal(article.freshness.canonicalContentHash, HASH_A);
	});

	it("overwrites estimatedReadTime with the supplied value", () => {
		const { article } = recrawlPromoteTier(
			buildArticle(),
			buildInput({ estimatedReadTime: 7 }),
		);

		assert.equal(article.estimatedReadTime, 7);
	});

	it("emits publish-canonical-content-changed and publish-recrawl-completed in that order", () => {
		const { effects } = recrawlPromoteTier(
			buildArticle({ url: "https://example.com/post" }),
			buildInput(),
		);

		assert.deepEqual(effects, [
			{ kind: "publish-canonical-content-changed", url: "https://example.com/post" },
			{ kind: "publish-recrawl-completed", url: "https://example.com/post" },
		]);
	});

	it("announces publish-canonical-content-changed even when the canonical hash is unchanged — an operator recrawl always regenerates the summary", () => {
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

		const { effects } = recrawlPromoteTier(
			before,
			buildInput({ canonicalContentHash: HASH_A }),
		);

		assert.deepEqual(effects, [
			{ kind: "publish-canonical-content-changed", url: "https://example.com/post" },
			{ kind: "publish-recrawl-completed", url: "https://example.com/post" },
		]);
	});

	it("leaves the summary axis untouched — regeneration is driven by the CanonicalContentChanged subscriber, including for a row stuck on skipped(content-too-short)", () => {
		const stuckSummary = { kind: "skipped" as const, reason: "content-too-short" };
		const before = buildArticle({
			freshness: {
				etag: '"old-etag"',
				lastModified: "Thu, 01 Jan 2026 00:00:00 GMT",
				contentFetchedAt: "2026-01-01T00:00:00.000Z",
				canonicalContentHash: HASH_A,
			},
			summary: stuckSummary,
		});

		const { article } = recrawlPromoteTier(
			before,
			buildInput({ canonicalContentHash: HASH_B }),
		);

		assert.deepEqual(article.summary, stuckSummary);
	});

	it("declares writes for metadata, freshness, and crawl only — never the summary axis", () => {
		const { writes } = recrawlPromoteTier(buildArticle(), buildInput());

		assert.deepEqual([...writes].sort(), ["crawl", "freshness", "metadata"]);
	});

	it("does not mutate the input article (pure function)", () => {
		const before = buildArticle();
		const snapshot = JSON.parse(JSON.stringify(before));

		recrawlPromoteTier(before, buildInput());

		assert.deepEqual(before, snapshot);
	});

	it("exposes its function name so transitionAndPersist can tag the row for the Phase 2 canary measurement", () => {
		assert.equal(recrawlPromoteTier.name, "recrawlPromoteTier");
	});
});
