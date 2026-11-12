import { CandidateIdSchema, SaveAttemptIdSchema } from "@packages/domain/article";
import { noopLogger } from "@packages/logger";
import { initInMemoryMeteredLegLedger } from "@packages/test-fixtures/providers/metered-leg-ledger";
import { candidateProvenance, type VerifiedTierSource } from "@packages/tier-source";
import { initRunMeteredLeg, type RunMeteredLeg } from "../metered-leg/run-metered-leg";
import { computeCanonicalContentHash } from "../generate-summary/compute-canonical-content-hash";
import type { ContentDecision, SelectMostCompleteContent } from "./select-content";
import assert from "node:assert/strict";
import { ContentJudgeClaimHeldError, initJudgeUnderLedger } from "./judge-under-ledger";

const URL = "https://example.com/article";
const NOW = "2026-11-05T00:00:00.000Z";
const cid = (id: string) => CandidateIdSchema.parse(id);

function source(id: string, html: string): VerifiedTierSource {
	return {
		tier: "tier-1", html,
		metadata: { ...candidateProvenance({
			metadata: { title: "Article", siteName: "example.com", excerpt: "Excerpt", wordCount: 100, estimatedReadTime: 1 },
			html, evaluationHtml: html, attemptId: SaveAttemptIdSchema.parse("attempt"), originalUrl: URL, sourceUrl: URL, kind: "live", fetchedAt: NOW,
		}), id: cid(id) },
	};
}

const FIRST_BODY = "<article><p>The first body of the article.</p></article>";
const SECOND_BODY = "<article><p>A second, different body.</p></article>";

function setup(params: { decision: ContentDecision; responseStatus?: "completed" | "rejected"; legsDeferred?: boolean }) {
	const selectMostCompleteContent = jest.fn<ReturnType<SelectMostCompleteContent>, Parameters<SelectMostCompleteContent>>(async ({ candidates }) => ({
		...params.decision,
		readability: candidates.map((candidate) => ({ candidateId: candidate.id, readable: true })),
		audit: { judgedCandidates: [], promptHash: "prompt", responseStatus: params.responseStatus ?? "completed" },
	}));
	const runMeteredLeg = initRunMeteredLeg({
		...initInMemoryMeteredLegLedger({ isMeteredLegsDeferred: () => params.legsDeferred ?? false, now: () => new Date(NOW) }),
		logger: noopLogger, now: () => new Date(NOW),
	});
	const judge = initJudgeUnderLedger({ selectMostCompleteContent, runMeteredLeg, claimTtlMs: 60_000, heldClaim: "wait-for-holder" });
	return {
		selectMostCompleteContent,
		judge: (sources: readonly VerifiedTierSource[], claimId = "message-1") => judge({ url: URL, originalUrl: URL, sources, proseHashOf: computeCanonicalContentHash, claimId }),
	};
}

describe("initJudgeUnderLedger", () => {
	it("answers none without claiming the judge when there is no candidate", async () => {
		const runMeteredLeg = jest.fn<ReturnType<RunMeteredLeg>, Parameters<RunMeteredLeg>>();
		const judge = initJudgeUnderLedger({ selectMostCompleteContent: jest.fn(), runMeteredLeg, claimTtlMs: 60_000, heldClaim: "wait-for-holder" });

		const decision = await judge({ url: URL, originalUrl: URL, sources: [], proseHashOf: computeCanonicalContentHash, claimId: "message-1" });

		expect(decision).toEqual({ kind: "none", reason: "no verified candidates", readability: [], judgedBodies: 0 });
		expect(runMeteredLeg).not.toHaveBeenCalled();
	});

	it("runs the judge under a granted claim and returns its decision", async () => {
		const { judge, selectMostCompleteContent } = setup({ decision: { kind: "winner", candidateId: cid("first"), reason: "Most complete" } });

		const decision = await judge([source("first", FIRST_BODY), source("second", SECOND_BODY)]);

		expect(decision).toEqual(expect.objectContaining({ kind: "winner", candidateId: cid("first"), reason: "Most complete", judgedBodies: 2 }));
		expect(selectMostCompleteContent).toHaveBeenCalledTimes(1);
	});

	it("replays a settled winner onto the current candidate holding the same body, without judging again", async () => {
		const { judge, selectMostCompleteContent } = setup({ decision: { kind: "winner", candidateId: cid("first"), reason: "Most complete" } });
		await judge([source("first", FIRST_BODY), source("second", SECOND_BODY)]);

		const decision = await judge([source("first-again", FIRST_BODY), source("second", SECOND_BODY)], "message-2");

		expect(decision).toEqual({ kind: "winner", candidateId: cid("first-again"), reason: "the content judge already settled this candidate set (winner)", readability: [{ candidateId: cid("first-again"), readable: true }], judgedBodies: 0 });
		expect(selectMostCompleteContent).toHaveBeenCalledTimes(1);
	});

	it("replays a settled winner as a tie when several current candidates hold its body", async () => {
		const { judge } = setup({ decision: { kind: "winner", candidateId: cid("first"), reason: "Most complete" } });
		await judge([source("first", FIRST_BODY), source("second", SECOND_BODY)]);

		const decision = await judge([source("first", FIRST_BODY), source("first-copy", FIRST_BODY), source("second", SECOND_BODY)], "message-2");

		expect(decision).toEqual(expect.objectContaining({ kind: "tie", candidateIds: [cid("first"), cid("first-copy")], judgedBodies: 0 }));
	});

	it("replays a settled tie onto every body it named", async () => {
		const { judge } = setup({ decision: { kind: "tie", candidateIds: [cid("first"), cid("second")], reason: "Equally complete" } });
		await judge([source("first", FIRST_BODY), source("second", SECOND_BODY)]);

		const decision = await judge([source("first", FIRST_BODY), source("second", SECOND_BODY)], "message-2");

		expect(decision).toEqual(expect.objectContaining({ kind: "tie", candidateIds: [cid("first"), cid("second")], reason: "the content judge already settled this candidate set (tie)" }));
	});

	it("replays a settled none without judging again", async () => {
		const { judge, selectMostCompleteContent } = setup({ decision: { kind: "none", reason: "Nothing readable" } });
		await judge([source("first", FIRST_BODY), source("second", SECOND_BODY)]);

		const decision = await judge([source("first", FIRST_BODY), source("second", SECOND_BODY)], "message-2");

		expect(decision).toEqual({ kind: "none", reason: "the content judge already settled this candidate set (none)", readability: [], judgedBodies: 0 });
		expect(selectMostCompleteContent).toHaveBeenCalledTimes(1);
	});

	it("leaves a provider-rejected verdict unsettled so the next delivery judges again", async () => {
		const { judge, selectMostCompleteContent } = setup({ decision: { kind: "none", reason: "rejected" }, responseStatus: "rejected" });
		const sources = [source("first", FIRST_BODY), source("second", SECOND_BODY)];

		const decision = await judge(sources);
		await judge(sources, "message-2");

		expect(decision).toEqual(expect.objectContaining({ kind: "none", reason: "rejected", audit: expect.objectContaining({ responseStatus: "rejected" }) }));
		expect(selectMostCompleteContent).toHaveBeenCalledTimes(2);
	});

	it("answers deferred without judging while the article's metered legs wait for a reader", async () => {
		const { judge, selectMostCompleteContent } = setup({ decision: { kind: "winner", candidateId: cid("first"), reason: "Most complete" }, legsDeferred: true });

		const decision = await judge([source("first", FIRST_BODY), source("second", SECOND_BODY)]);

		expect(decision).toEqual({ kind: "deferred", reason: "the content judge waits for a reader to open the article", readability: [], judgedBodies: 0 });
		expect(selectMostCompleteContent).not.toHaveBeenCalled();
	});

	it("fails the delivery while another delivery holds the judge", async () => {
		const judge = initJudgeUnderLedger({ selectMostCompleteContent: jest.fn(), runMeteredLeg: async () => ({ kind: "in-flight" }), claimTtlMs: 60_000, heldClaim: "wait-for-holder" });

		await expect(judge({ url: URL, originalUrl: URL, sources: [source("first", FIRST_BODY)], proseHashOf: computeCanonicalContentHash, claimId: "message-2" }))
			.rejects.toThrow(`another delivery holds the content judge for ${URL}`);
	});

	it("raises a typed ownership anomaly carrying the URL and its own claim lease when asked to, without calling the model", async () => {
		const selectMostCompleteContent = jest.fn();
		const judge = initJudgeUnderLedger({ selectMostCompleteContent, runMeteredLeg: async () => ({ kind: "in-flight" }), claimTtlMs: 360_000, heldClaim: "raise-ownership-anomaly" });

		const raised = await judge({ url: URL, originalUrl: URL, sources: [source("first", FIRST_BODY)], proseHashOf: computeCanonicalContentHash, claimId: "message-2" }).catch((error: unknown) => error);

		assert(raised instanceof ContentJudgeClaimHeldError);
		assert.equal(raised.url, URL);
		assert.equal(raised.claimTtlMs, 360_000);
		assert.equal(raised.message, `another owner holds the content judge for ${URL}`);
		expect(selectMostCompleteContent).not.toHaveBeenCalled();
	});
});
