import assert from "node:assert/strict";
import { CandidateIdSchema } from "@packages/domain/article";
import { type Article, type SelectionConflict, SelectionSnapshotChangedError } from "@packages/domain/article-aggregate";
import { initInMemoryArticleStore } from "./in-memory-article-store";

const refusedAs = (conflict: SelectionConflict) => (error: unknown) => error instanceof SelectionSnapshotChangedError && error.conflict === conflict;

function buildArticle(url: string, summary: Article["summary"] = { kind: "pending", pendingSince: "2026-01-01T00:00:00.000Z" }): Article {
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
		summaryAutoHeal: { attempts: 0 },
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

		await store.save({
			article,
			writes: ["metadata", "freshness", "summary"],
		});
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

		await store.save({
			article,
			writes: ["metadata"],
		});
		const loaded = await store.load(
			"https://example.com/article?utm_source=newsletter",
		);

		assert(loaded, "expected the store to find the row after stripping tracking params");
		assert.equal(loaded.url, "https://example.com/article?utm_source=newsletter");
	});

	it("overwrites the previously saved aggregate on a second save (last-writer-wins)", async () => {
		const store = initInMemoryArticleStore();
		await store.save({
			article: buildArticle("https://example.com/a", { kind: "ready", summary: "old" }),
			writes: ["summary"],
		});

		await store.save({
			article: buildArticle("https://example.com/a", { kind: "pending", pendingSince: "2026-01-01T00:00:00.000Z" }),
			writes: ["summary"],
		});
		const loaded = await store.load("https://example.com/a");

		assert(loaded, "loaded should not be undefined after save");
		assert.deepEqual(loaded.summary, { kind: "pending", pendingSince: "2026-01-01T00:00:00.000Z" });
	});

	it("records each save's writes scope so tests can assert what the orchestrator threaded through", async () => {
		const store = initInMemoryArticleStore();

		await store.save({
			article: buildArticle("https://example.com/a"),
			writes: ["crawl", "summary"],
		});

		assert.equal(store.savedCalls.length, 1);
		assert.deepEqual([...(store.savedCalls[0]?.writes ?? [])], ["crawl", "summary"]);
	});

	describe("a save guarded on the canonical content", () => {
		const url = "https://example.com/guarded";
		const canonical = { candidateId: CandidateIdSchema.parse("same"), contentLocation: "s3://bucket/same.html" };
		const guarded = (store: ReturnType<typeof initInMemoryArticleStore>, snapshot: Article["contentSelection"]) =>
			store.save({ article: buildArticle(url, { kind: "ready", summary: "Summary" }), writes: ["summary"], selectionExpected: { scope: "canonical-content", snapshot } });

		it("lands when only the selection revision moved", async () => {
			const store = initInMemoryArticleStore();
			store.seed({ ...buildArticle(url), contentSelection: { revision: 2, ...canonical } });

			await guarded(store, { revision: 1, ...canonical });

			assert.equal((await store.load(url))?.summary.kind, "ready");
		});

		it("fails when another candidate became canonical", async () => {
			const store = initInMemoryArticleStore();
			store.seed({ ...buildArticle(url), contentSelection: { revision: 2, candidateId: CandidateIdSchema.parse("other"), contentLocation: "s3://bucket/other.html" } });

			await assert.rejects(guarded(store, { revision: 1, ...canonical }), refusedAs("canonical-content-changed"));
		});

		it("fails when the canonical candidate was revoked", async () => {
			const store = initInMemoryArticleStore();
			store.seed({ ...buildArticle(url), contentSelection: { revision: 1, ...canonical, revokedCandidateIds: [canonical.candidateId] } });

			await assert.rejects(guarded(store, { revision: 1, ...canonical }), refusedAs("candidate-revoked"));
		});
	});

	describe("a canonical commit guarded on the selection snapshot", () => {
		const url = "https://example.com/committed";
		const commit = { expected: { revision: 1, candidateId: CandidateIdSchema.parse("first"), contentLocation: "s3://bucket/first.html" }, candidateId: CandidateIdSchema.parse("late"), contentLocation: "s3://bucket/late.html", originalUrl: url, tier: "tier-1" as const };
		const committing = (store: ReturnType<typeof initInMemoryArticleStore>) => store.save({ article: buildArticle(url), writes: ["crawl"], canonicalCommit: commit });

		it("lands on the expected snapshot and advances the revision", async () => {
			const store = initInMemoryArticleStore();
			store.seed({ ...buildArticle(url), contentSelection: commit.expected });

			await committing(store);

			assert.deepEqual((await store.load(url))?.contentSelection, { revision: 2, candidateId: commit.candidateId, contentLocation: commit.contentLocation, tier: "tier-1" });
		});

		it("fails when a competing selector committed first", async () => {
			const store = initInMemoryArticleStore();
			store.seed({ ...buildArticle(url), contentSelection: { ...commit.expected, revision: 2 } });

			await assert.rejects(committing(store), refusedAs("selection-changed"));
		});

		it("fails when its candidate was revoked since preparation", async () => {
			const store = initInMemoryArticleStore();
			store.seed({ ...buildArticle(url), contentSelection: { ...commit.expected, revokedCandidateIds: [commit.candidateId] } });

			await assert.rejects(committing(store), refusedAs("candidate-revoked"));
		});

		it("leaves a tombstoned row untouched", async () => {
			const store = initInMemoryArticleStore();
			const tombstoned = { ...buildArticle(url), purgedAt: "2026-01-02T00:00:00.000Z" };
			store.seed(tombstoned);

			await committing(store);

			assert.deepEqual(await store.load(url), tombstoned);
		});
	});
});
