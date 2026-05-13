import assert from "node:assert/strict";
import type { Article } from "../article.types";
import { incrementSummaryAutoHealAttempt } from "./increment-summary-auto-heal-attempt";

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
		crawl: { kind: "ready" },
		summary: { kind: "failed", reason: { kind: "model-overload" } },
		summaryAutoHeal: { attempts: 0 },
		...overrides,
	};
}

describe("incrementSummaryAutoHealAttempt", () => {
	it("flips summary from failed back to pending so the worker re-runs the regen", () => {
		const before = buildArticle({ summary: { kind: "failed", reason: { kind: "model-overload" } } });

		const { article } = incrementSummaryAutoHealAttempt(before, { now: NOW });

		assert.deepEqual(article.summary, { kind: "pending", pendingSince: NOW });
	});

	it("increments attempts from 0 to 1 on the first heal", () => {
		const before = buildArticle({
			summaryAutoHeal: { attempts: 0 },
		});

		const { article } = incrementSummaryAutoHealAttempt(before, { now: NOW });

		assert.equal(article.summaryAutoHeal.attempts, 1);
		assert.equal(article.summaryAutoHeal.lastAttemptAt, NOW);
	});

	it("increments attempts on subsequent retries so the gate can stop after the budget", () => {
		const before = buildArticle({
			summaryAutoHeal: {
				attempts: 2,
				lastAttemptAt: "2026-05-12T12:00:00.000Z",
			},
		});

		const { article } = incrementSummaryAutoHealAttempt(before, { now: NOW });

		assert.equal(article.summaryAutoHeal.attempts, 3);
		assert.equal(article.summaryAutoHeal.lastAttemptAt, NOW);
	});

	it("emits dispatch-generate-summary-retry carrying url and the new attempt count", () => {
		const before = buildArticle({
			url: "https://example.com/post",
			summaryAutoHeal: { attempts: 1, lastAttemptAt: NOW },
		});

		const { effects } = incrementSummaryAutoHealAttempt(before, { now: NOW });

		assert.deepEqual(effects, [
			{
				kind: "dispatch-generate-summary-retry",
				url: "https://example.com/post",
				attempt: 2,
			},
		]);
	});

	it("declares writes for summary + summaryAutoHeal so the crawl axis is not clobbered", () => {
		const { writes } = incrementSummaryAutoHealAttempt(buildArticle(), { now: NOW });

		assert.deepEqual([...writes].sort(), ["summary", "summaryAutoHeal"]);
	});

	it("does not mutate the input article (pure function)", () => {
		const before = buildArticle();
		const snapshot = JSON.parse(JSON.stringify(before));

		incrementSummaryAutoHealAttempt(before, { now: NOW });

		assert.deepEqual(before, snapshot);
	});

	it("exposes its function name so transitionAndPersist can tag the row for the Phase 2 canary measurement", () => {
		assert.equal(
			incrementSummaryAutoHealAttempt.name,
			"incrementSummaryAutoHealAttempt",
		);
	});
});
