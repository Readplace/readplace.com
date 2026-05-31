import assert from "node:assert/strict";
import type { Article } from "../article.types";
import { markSummaryPending } from "./mark-summary-pending";

const NOW = "2026-05-31T12:00:00.000Z";
const EARLIER = "2026-05-13T12:00:00.000Z";

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
		summary: { kind: "skipped", reason: "content-too-short" },
		summaryAutoHeal: { attempts: 0 },
		...overrides,
	};
}

describe("markSummaryPending", () => {
	it("flips a terminal skipped summary back to pending, stamping pendingSince with the supplied now", () => {
		const before = buildArticle({
			summary: { kind: "skipped", reason: "content-too-short" },
		});

		const { article } = markSummaryPending(before, { now: NOW });

		assert.deepEqual(article.summary, { kind: "pending", pendingSince: NOW });
	});

	it("flips a terminal ready summary back to pending so the worker regenerates against the new canonical", () => {
		const before = buildArticle({
			summary: { kind: "ready", summary: "stale", excerpt: "stale" },
		});

		const { article } = markSummaryPending(before, { now: NOW });

		assert.deepEqual(article.summary, { kind: "pending", pendingSince: NOW });
	});

	it("preserves the existing pendingSince when the summary is already pending (re-prime must not reset the SLO age-gate)", () => {
		const before = buildArticle({
			summary: { kind: "pending", pendingSince: EARLIER },
		});

		const { article } = markSummaryPending(before, { now: NOW });

		assert.deepEqual(article.summary, { kind: "pending", pendingSince: EARLIER });
	});

	it("emits a single generate-summary effect carrying the url so the existing worker re-runs", () => {
		const before = buildArticle({ url: "https://example.com/post" });

		const { effects } = markSummaryPending(before, { now: NOW });

		assert.deepEqual(effects, [
			{ kind: "generate-summary", url: "https://example.com/post" },
		]);
	});

	it("declares writes for summary only so a concurrent crawl-axis writer is not clobbered", () => {
		const { writes } = markSummaryPending(buildArticle(), { now: NOW });

		assert.deepEqual([...writes], ["summary"]);
	});

	it("does not mutate the input article (pure function)", () => {
		const before = buildArticle();
		const snapshot = JSON.parse(JSON.stringify(before));

		markSummaryPending(before, { now: NOW });

		assert.deepEqual(before, snapshot);
	});

	it("exposes its function name so transitionAndPersist can tag the row for the Phase 2 canary measurement", () => {
		assert.equal(markSummaryPending.name, "markSummaryPending");
	});
});
