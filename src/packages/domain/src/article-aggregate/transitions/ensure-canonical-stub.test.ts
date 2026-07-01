import assert from "node:assert/strict";
import type { Article } from "../article.types";
import { ensureCanonicalStub } from "./ensure-canonical-stub";

function buildArticle(overrides: Partial<Article> = {}): Article {
	return {
		url: "https://example.com/canonical",
		metadata: { title: "Title", siteName: "Example", excerpt: "Excerpt", wordCount: 100 },
		freshness: { contentFetchedAt: "2026-01-01T00:00:00.000Z" },
		estimatedReadTime: 1,
		crawl: { kind: "ready" },
		summary: { kind: "ready", summary: "s" },
		summaryAutoHeal: { attempts: 0 },
		...overrides,
	};
}

describe("ensureCanonicalStub", () => {
	it("no-ops on an existing row so a redelivery never resets a ready canonical to pending", () => {
		const existing = buildArticle();
		const result = ensureCanonicalStub(existing, { url: existing.url, now: "2026-02-02T00:00:00.000Z" });
		assert.equal(result.article, existing);
		assert.deepEqual(result.writes, []);
		assert.deepEqual(result.effects, []);
	});

	it("synthesises a hostname-only pending stub when the canonical row is absent, with no dispatch effect", () => {
		const result = ensureCanonicalStub(undefined, {
			url: "https://example.com/final",
			now: "2026-02-02T00:00:00.000Z",
		});
		assert.deepEqual(result.article.crawl, { kind: "pending", pendingSince: "2026-02-02T00:00:00.000Z" });
		assert.deepEqual(result.article.summary, { kind: "pending", pendingSince: "2026-02-02T00:00:00.000Z" });
		assert.equal(result.article.metadata.siteName, "example.com");
		assert.deepEqual(result.writes, ["crawl", "summary", "metadata", "freshness"]);
		assert.deepEqual(result.effects, []);
	});
});
