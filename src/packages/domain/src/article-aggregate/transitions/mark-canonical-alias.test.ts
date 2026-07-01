import assert from "node:assert/strict";
import type { Article } from "../article.types";
import { markCanonicalAlias } from "./mark-canonical-alias";

function buildArticle(overrides: Partial<Article> = {}): Article {
	return {
		url: "https://example.com/as-entered",
		metadata: { title: "Title", siteName: "Example", excerpt: "Excerpt", wordCount: 100 },
		freshness: { contentFetchedAt: "2026-01-01T00:00:00.000Z" },
		estimatedReadTime: 1,
		crawl: { kind: "pending", pendingSince: "2026-01-01T00:00:00.000Z" },
		summary: { kind: "pending", pendingSince: "2026-01-01T00:00:00.000Z" },
		summaryAutoHeal: { attempts: 0 },
		...overrides,
	};
}

describe("markCanonicalAlias", () => {
	it("stamps the canonical pointer and turns the row terminal-good so neither canary flags it", () => {
		const { article } = markCanonicalAlias(buildArticle(), { canonicalUrl: "https://example.com/canonical" });
		assert.equal(article.canonicalUrl, "https://example.com/canonical");
		assert.deepEqual(article.crawl, { kind: "ready" });
		assert.deepEqual(article.summary, { kind: "skipped", reason: "canonical-alias" });
	});

	it("emits no effects (the alias row is never rendered) and scopes the write to crawl/summary/canonicalUrl", () => {
		const result = markCanonicalAlias(buildArticle(), { canonicalUrl: "https://example.com/canonical" });
		assert.deepEqual(result.effects, []);
		assert.deepEqual(result.writes, ["crawl", "summary", "canonicalUrl"]);
	});
});
