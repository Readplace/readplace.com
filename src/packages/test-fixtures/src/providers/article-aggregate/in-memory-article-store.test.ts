import assert from "node:assert/strict";
import type { Article } from "@packages/domain/article-aggregate";
import { initInMemoryArticleStore } from "./in-memory-article-store";

function buildArticle(url: string, summary: Article["summary"] = { kind: "pending" }): Article {
	return {
		url,
		metadata: {
			title: "Title",
			siteName: "Example",
			excerpt: "Excerpt",
			wordCount: 100,
		},
		freshness: { contentFetchedAt: "2026-01-01T00:00:00.000Z" },
		estimatedReadTime: 1,
		crawl: { kind: "ready" },
		summary,
	};
}

describe("initInMemoryArticleStore", () => {
	it("returns undefined when the article has not been seeded or saved", async () => {
		const store = initInMemoryArticleStore();

		const loaded = await store.load("https://example.com/missing");

		assert.equal(loaded, undefined);
	});

	it("save then load returns the persisted aggregate", async () => {
		const store = initInMemoryArticleStore();
		const article = buildArticle("https://example.com/article", {
			kind: "ready",
			summary: "x",
		});

		await store.save(article);
		const loaded = await store.load("https://example.com/article");

		assert.deepEqual(loaded, article);
	});

	it("seed primes the store so load returns the aggregate without a prior save", async () => {
		const store = initInMemoryArticleStore();
		const article = buildArticle("https://example.com/seeded");

		store.seed(article);
		const loaded = await store.load("https://example.com/seeded");

		assert.deepEqual(loaded, article);
	});

	it("normalizes the URL so a URL with tracking params reads the same row as the canonical URL", async () => {
		const store = initInMemoryArticleStore();
		const article = buildArticle("https://example.com/article");

		await store.save(article);
		const loaded = await store.load(
			"https://example.com/article?utm_source=newsletter",
		);

		assert(loaded, "expected the store to find the row after stripping tracking params");
		assert.equal(loaded.url, "https://example.com/article?utm_source=newsletter");
	});

	it("overwrites the previously saved aggregate on a second save (last-writer-wins)", async () => {
		const store = initInMemoryArticleStore();
		await store.save(buildArticle("https://example.com/a", { kind: "ready", summary: "old" }));

		await store.save(buildArticle("https://example.com/a", { kind: "pending" }));
		const loaded = await store.load("https://example.com/a");

		assert(loaded, "loaded should not be undefined after save");
		assert.deepEqual(loaded.summary, { kind: "pending" });
	});
});
