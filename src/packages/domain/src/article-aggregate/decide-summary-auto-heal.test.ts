import assert from "node:assert/strict";
import type { Article } from "./article.types";
import {
	SUMMARY_AUTO_HEAL_MAX_ATTEMPTS,
	SUMMARY_AUTO_HEAL_TTL_MS,
} from "./auto-heal-constants";
import { decideSummaryAutoHeal } from "./decide-summary-auto-heal";

const NOW = new Date("2026-05-13T12:00:00.000Z");

function buildArticle(overrides: Partial<Article> = {}): Article {
	return {
		url: "https://example.com/article",
		metadata: { title: "t", siteName: "s", excerpt: "e", wordCount: 1 },
		freshness: { contentFetchedAt: "2026-01-01T00:00:00.000Z" },
		estimatedReadTime: 1,
		crawl: { kind: "ready" },
		summary: { kind: "failed", reason: { kind: "model-overload" } },
		summaryAutoHeal: { attempts: 0 },
		...overrides,
	};
}

describe("decideSummaryAutoHeal", () => {
	it("skips when summary is ready (auto-heal only fires on failed)", () => {
		const article = buildArticle({
			summary: { kind: "ready", summary: "abc" },
		});

		assert.equal(decideSummaryAutoHeal(article, NOW), "skip");
	});

	it("skips when summary is pending (worker is already running, don't double-dispatch)", () => {
		const article = buildArticle({
			summary: { kind: "pending", pendingSince: NOW.toISOString() },
		});

		assert.equal(decideSummaryAutoHeal(article, NOW), "skip");
	});

	it("skips when summary is skipped (skip is terminal by user/system decision)", () => {
		const article = buildArticle({
			summary: { kind: "skipped", reason: "crawl-unsupported" },
		});

		assert.equal(decideSummaryAutoHeal(article, NOW), "skip");
	});

	it("reprimes a failed summary on the first attempt", () => {
		const article = buildArticle({
			summary: { kind: "failed", reason: { kind: "model-overload" } },
			summaryAutoHeal: { attempts: 0 },
		});

		assert.equal(decideSummaryAutoHeal(article, NOW), "reprime");
	});

	it("reprimes a failed summary up to the attempt budget", () => {
		const article = buildArticle({
			summaryAutoHeal: {
				attempts: SUMMARY_AUTO_HEAL_MAX_ATTEMPTS - 1,
				lastAttemptAt: NOW.toISOString(),
			},
		});

		assert.equal(decideSummaryAutoHeal(article, NOW), "reprime");
	});

	it("skips a failed summary that exhausted the budget and the TTL hasn't elapsed yet", () => {
		const justUnderTtl = new Date(
			NOW.getTime() - (SUMMARY_AUTO_HEAL_TTL_MS - 60_000),
		).toISOString();
		const article = buildArticle({
			summaryAutoHeal: {
				attempts: SUMMARY_AUTO_HEAL_MAX_ATTEMPTS,
				lastAttemptAt: justUnderTtl,
			},
		});

		assert.equal(decideSummaryAutoHeal(article, NOW), "skip");
	});

	it("reprimes a failed summary that exhausted the budget once the TTL has elapsed (next round gets fresh budget)", () => {
		const beyondTtl = new Date(
			NOW.getTime() - (SUMMARY_AUTO_HEAL_TTL_MS + 60_000),
		).toISOString();
		const article = buildArticle({
			summaryAutoHeal: {
				attempts: SUMMARY_AUTO_HEAL_MAX_ATTEMPTS,
				lastAttemptAt: beyondTtl,
			},
		});

		assert.equal(decideSummaryAutoHeal(article, NOW), "reprime");
	});

	it("reprimes exactly at the TTL boundary so the wait isn't extended by a millisecond drift", () => {
		const atTtl = new Date(
			NOW.getTime() - SUMMARY_AUTO_HEAL_TTL_MS,
		).toISOString();
		const article = buildArticle({
			summaryAutoHeal: {
				attempts: SUMMARY_AUTO_HEAL_MAX_ATTEMPTS,
				lastAttemptAt: atTtl,
			},
		});

		assert.equal(decideSummaryAutoHeal(article, NOW), "reprime");
	});

	it("skips a failed summary with budget exhausted and no recorded lastAttemptAt (fails closed)", () => {
		const article = buildArticle({
			summaryAutoHeal: { attempts: SUMMARY_AUTO_HEAL_MAX_ATTEMPTS },
		});

		assert.equal(decideSummaryAutoHeal(article, NOW), "skip");
	});
});
