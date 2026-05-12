import assert from "node:assert/strict";
import type { Article } from "../article.types";
import { recrawlPromoteTier } from "./recrawl-promote-tier";

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
		crawl: { kind: "pending" },
		summary: { kind: "ready", summary: "old" },
		...overrides,
	};
}

describe("recrawlPromoteTier", () => {
	it("flips crawl from pending to ready after a tier promotion", () => {
		const { article } = recrawlPromoteTier(buildArticle(), {
			winnerTier: "tier-1",
		});

		assert.deepEqual(article.crawl, { kind: "ready" });
	});

	it("emits generate-summary and publish-recrawl-completed effects in that order", () => {
		const { effects } = recrawlPromoteTier(
			buildArticle({ url: "https://example.com/post" }),
			{ winnerTier: "tier-0" },
		);

		assert.deepEqual(effects, [
			{ kind: "generate-summary", url: "https://example.com/post" },
			{ kind: "publish-recrawl-completed", url: "https://example.com/post" },
		]);
	});

	it("declares writes for crawl only (the canonical metadata + S3 copy are owned by promoteTierToCanonical outside the aggregate)", () => {
		const { writes } = recrawlPromoteTier(buildArticle(), {
			winnerTier: "tier-1",
		});

		assert.deepEqual([...writes], ["crawl"]);
	});

	it("does not mutate the input article (pure function)", () => {
		const before = buildArticle();
		const snapshot = JSON.parse(JSON.stringify(before));

		recrawlPromoteTier(before, { winnerTier: "tier-1" });

		assert.deepEqual(before, snapshot);
	});

	it("produces the same aggregate state regardless of which tier won (sibling-transition contract)", () => {
		const tier0 = recrawlPromoteTier(buildArticle(), { winnerTier: "tier-0" });
		const tier1 = recrawlPromoteTier(buildArticle(), { winnerTier: "tier-1" });

		assert.deepEqual(tier0.article, tier1.article);
		assert.deepEqual(tier0.effects, tier1.effects);
		assert.deepEqual(tier0.writes, tier1.writes);
	});

	it("exposes its function name so transitionAndPersist can tag the row for the Phase 2 canary measurement", () => {
		assert.equal(recrawlPromoteTier.name, "recrawlPromoteTier");
	});
});
