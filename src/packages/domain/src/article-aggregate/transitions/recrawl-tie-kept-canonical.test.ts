import assert from "node:assert/strict";
import type { Article } from "../article.types";
import { recrawlTieKeptCanonical } from "./recrawl-tie-kept-canonical";

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
		summary: { kind: "ready", summary: "old" },
		...overrides,
	};
}

describe("recrawlTieKeptCanonical", () => {
	it("flips crawl from pending to ready (unsticks the row admin/recrawl wrote pending)", () => {
		const { article } = recrawlTieKeptCanonical(buildArticle(), undefined);

		assert.deepEqual(article.crawl, { kind: "ready" });
	});

	it("preserves summary so a freshly-generated AI excerpt is not invalidated by the recrawl no-op", () => {
		const before = buildArticle({
			summary: { kind: "ready", summary: "kept", excerpt: "kept excerpt" },
		});

		const { article } = recrawlTieKeptCanonical(before, undefined);

		assert.deepEqual(article.summary, {
			kind: "ready",
			summary: "kept",
			excerpt: "kept excerpt",
		});
	});

	it("emits a generate-summary effect so the operator always sees a freshly-regenerated excerpt", () => {
		const { effects } = recrawlTieKeptCanonical(
			buildArticle({ url: "https://example.com/post" }),
			undefined,
		);

		assert.ok(
			effects.some(
				(e) =>
					e.kind === "generate-summary" && e.url === "https://example.com/post",
			),
			"generate-summary effect must be emitted on every recrawl",
		);
	});

	it("emits a publish-recrawl-completed effect after the generate-summary effect", () => {
		const { effects } = recrawlTieKeptCanonical(
			buildArticle({ url: "https://example.com/post" }),
			undefined,
		);

		assert.deepEqual(effects, [
			{ kind: "generate-summary", url: "https://example.com/post" },
			{ kind: "publish-recrawl-completed", url: "https://example.com/post" },
		]);
	});

	it("declares writes for crawl only (canonical is preserved by definition of this branch)", () => {
		const { writes } = recrawlTieKeptCanonical(buildArticle(), undefined);

		assert.deepEqual([...writes], ["crawl"]);
	});

	it("does not mutate the input article (pure function)", () => {
		const before = buildArticle();
		const snapshot = JSON.parse(JSON.stringify(before));

		recrawlTieKeptCanonical(before, undefined);

		assert.deepEqual(before, snapshot);
	});

	it("exposes its function name so transitionAndPersist can tag the row for the Phase 2 canary measurement", () => {
		assert.equal(recrawlTieKeptCanonical.name, "recrawlTieKeptCanonical");
	});
});
