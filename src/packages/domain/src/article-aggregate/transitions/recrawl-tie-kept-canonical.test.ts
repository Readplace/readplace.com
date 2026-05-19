import assert from "node:assert/strict";
import type { Article } from "../article.types";
import {
	recrawlTieKeptCanonical,
	type RecrawlTieKeptCanonicalInput,
} from "./recrawl-tie-kept-canonical";

const NOW = "2026-05-13T12:00:00.000Z";

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
		summaryAutoHeal: { attempts: 0 },
		...overrides,
	};
}

function buildInput(overrides: Partial<RecrawlTieKeptCanonicalInput> = {}): RecrawlTieKeptCanonicalInput {
	return { now: NOW, ...overrides };
}

describe("recrawlTieKeptCanonical", () => {
	it("flips crawl from pending to ready (unsticks the row admin/recrawl wrote pending)", () => {
		const { article } = recrawlTieKeptCanonical(buildArticle(), buildInput());

		assert.deepEqual(article.crawl, { kind: "ready" });
	});

	it("preserves the existing ready summary by not transitioning summary state at all", () => {
		const before = buildArticle({
			summary: { kind: "ready", summary: "kept", excerpt: "kept excerpt" },
		});

		const { article } = recrawlTieKeptCanonical(before, buildInput());

		assert.deepEqual(article.summary, {
			kind: "ready",
			summary: "kept",
			excerpt: "kept excerpt",
		});
	});

	it("does not emit generate-summary when summary is ready (identical canonical content does not burn DeepSeek tokens)", () => {
		const { effects } = recrawlTieKeptCanonical(
			buildArticle({ url: "https://example.com/post" }),
			buildInput(),
		);

		assert.ok(
			!effects.some((e) => e.kind === "generate-summary"),
			"generate-summary effect must not be emitted when canonical is unchanged",
		);
	});

	it("emits only publish-recrawl-completed when summary is healthy", () => {
		const { effects } = recrawlTieKeptCanonical(
			buildArticle({ url: "https://example.com/post" }),
			buildInput(),
		);

		assert.deepEqual(effects, [
			{ kind: "publish-recrawl-completed", url: "https://example.com/post" },
		]);
	});

	it("declares writes for crawl only when summary is healthy", () => {
		const { writes } = recrawlTieKeptCanonical(buildArticle(), buildInput());

		assert.deepEqual([...writes], ["crawl"]);
	});

	it("resets summary to pending when summary is failed(crawl-failed) — the cross-axis pairing from markCrawlExhausted is stale", () => {
		const before = buildArticle({
			summary: {
				kind: "failed",
				reason: { kind: "crawl-failed" },
			},
		});

		const { article } = recrawlTieKeptCanonical(before, buildInput());

		assert.deepEqual(article.summary, { kind: "pending", pendingSince: NOW });
	});

	it("emits generate-summary when summary is failed(crawl-failed)", () => {
		const before = buildArticle({
			url: "https://example.com/post",
			summary: {
				kind: "failed",
				reason: { kind: "crawl-failed" },
			},
		});

		const { effects } = recrawlTieKeptCanonical(before, buildInput());

		assert.deepEqual(effects, [
			{ kind: "generate-summary", url: "https://example.com/post" },
			{ kind: "publish-recrawl-completed", url: "https://example.com/post" },
		]);
	});

	it("includes summary in writes when summary is failed(crawl-failed)", () => {
		const before = buildArticle({
			summary: {
				kind: "failed",
				reason: { kind: "crawl-failed" },
			},
		});

		const { writes } = recrawlTieKeptCanonical(before, buildInput());

		assert.deepEqual([...writes].sort(), ["crawl", "summary"]);
	});

	it("preserves failed(exhausted-retries) summary — only crawl-failed is stale", () => {
		const existingSummary = {
			kind: "failed" as const,
			reason: { kind: "exhausted-retries" as const, receiveCount: 4 },
		};
		const before = buildArticle({ summary: existingSummary });

		const { article } = recrawlTieKeptCanonical(before, buildInput());

		assert.deepEqual(article.summary, existingSummary);
	});

	it("does not mutate the input article (pure function)", () => {
		const before = buildArticle();
		const snapshot = JSON.parse(JSON.stringify(before));

		recrawlTieKeptCanonical(before, buildInput());

		assert.deepEqual(before, snapshot);
	});

	it("exposes its function name so transitionAndPersist can tag the row for the Phase 2 canary measurement", () => {
		assert.equal(recrawlTieKeptCanonical.name, "recrawlTieKeptCanonical");
	});
});
