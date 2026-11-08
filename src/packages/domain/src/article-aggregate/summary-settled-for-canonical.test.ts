import assert from "node:assert/strict";
import { CandidateIdSchema } from "../article/article.schema";
import type { Article } from "./article.types";
import { isSummarySettledForCanonical } from "./summary-settled-for-canonical";

const candidateId = CandidateIdSchema.parse("candidate");

function buildArticle(overrides: Partial<Article>): Article {
	return {
		url: "https://example.com/article",
		metadata: { title: "Title", siteName: "Example", excerpt: "Excerpt", wordCount: 100 },
		freshness: { contentFetchedAt: "2026-01-01T00:00:00.000Z", canonicalContentHash: "current-hash" },
		estimatedReadTime: 1,
		crawl: { kind: "ready" },
		summary: { kind: "pending", pendingSince: "2026-01-01T00:00:00.000Z" },
		summaryAutoHeal: { attempts: 0 },
		...overrides,
	};
}

describe("isSummarySettledForCanonical", () => {
	it("settles a ready summary generated from the current canonical candidate", () => {
		assert.equal(isSummarySettledForCanonical(buildArticle({
			contentSelection: { candidateId },
			summary: { kind: "ready", summary: "S", sourceContentHash: "current-hash" },
		})), true);
	});

	it("does not settle a ready summary generated from another canonical body", () => {
		assert.equal(isSummarySettledForCanonical(buildArticle({
			contentSelection: { candidateId },
			summary: { kind: "ready", summary: "S", sourceContentHash: "old-hash" },
		})), false);
	});

	it("settles a legacy ready summary with no candidate and no source hash", () => {
		assert.equal(isSummarySettledForCanonical(buildArticle({
			summary: { kind: "ready", summary: "S" },
		})), true);
	});

	it("does not settle a legacy ready summary with no candidate whose hash differs from the canonical", () => {
		assert.equal(isSummarySettledForCanonical(buildArticle({
			summary: { kind: "ready", summary: "S", sourceContentHash: "old-hash" },
		})), false);
	});

	it("settles a skipped summary", () => {
		assert.equal(isSummarySettledForCanonical(buildArticle({
			summary: { kind: "skipped", reason: "declined" },
		})), true);
	});

	it("does not settle a pending summary", () => {
		assert.equal(isSummarySettledForCanonical(buildArticle({
			summary: { kind: "pending", pendingSince: "2026-01-01T00:00:00.000Z" },
		})), false);
	});

	it("does not settle a failed summary", () => {
		assert.equal(isSummarySettledForCanonical(buildArticle({
			summary: { kind: "failed", reason: { kind: "exhausted-retries", receiveCount: 3 } },
		})), false);
	});

	it("does not settle a matching ready summary once its canonical candidate is revoked", () => {
		assert.equal(isSummarySettledForCanonical(buildArticle({
			contentSelection: { candidateId, revokedCandidateIds: [candidateId] },
			summary: { kind: "ready", summary: "S", sourceContentHash: "current-hash" },
		})), false);
	});

	it("does not settle a skipped summary once its canonical candidate is revoked", () => {
		assert.equal(isSummarySettledForCanonical(buildArticle({
			contentSelection: { candidateId, revokedCandidateIds: [candidateId] },
			summary: { kind: "skipped", reason: "crawl-failed" },
		})), false);
	});
});
