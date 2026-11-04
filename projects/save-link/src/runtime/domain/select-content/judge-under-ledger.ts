import assert from "node:assert";
import { z } from "zod";
import type { CandidateId } from "@packages/domain/article";
import type { VerifiedTierSource } from "@packages/tier-source";
import type { ContentDecision, SelectMostCompleteContent, SelectionAudit } from "./select-content";
import type { RunMeteredLeg } from "../metered-leg/run-metered-leg";
import { judgeCandidates } from "./prepare-content-selection";

export type JudgeDecision =
	| (ContentDecision & { readability: readonly { candidateId: CandidateId; readable: boolean }[]; audit?: SelectionAudit; judgedBodies: number })
	| { kind: "deferred"; reason: string; readability: readonly []; judgedBodies: 0 };

export type JudgeCandidates = (params: {
	url: string;
	originalUrl: string;
	sources: readonly VerifiedTierSource[];
	proseHashOf: (html: string) => string;
	claimId: string;
}) => Promise<JudgeDecision>;

const SettledVerdictSchema = z.object({
	kind: z.enum(["winner", "tie", "none"]),
	contentHashes: z.array(z.string()),
});

function verdictOf(params: { decision: ContentDecision; sources: readonly VerifiedTierSource[] }): z.infer<typeof SettledVerdictSchema> {
	const { decision, sources } = params;
	const chosen = decision.kind === "none" ? [] : decision.kind === "winner" ? [decision.candidateId] : decision.candidateIds;
	const contentHashes = chosen.map((candidateId) => {
		const source = sources.find((candidate) => candidate.metadata.id === candidateId);
		assert(source, `the judge chose a candidate that was not offered: ${candidateId}`);
		return source.metadata.contentHash;
	});
	return { kind: decision.kind, contentHashes: [...new Set(contentHashes)].sort() };
}

function replayVerdict(params: { outcome: string; sources: readonly VerifiedTierSource[] }): JudgeDecision {
	const verdict = SettledVerdictSchema.parse(JSON.parse(params.outcome));
	const reason = `the content judge already settled this candidate set (${verdict.kind})`;
	if (verdict.kind === "none") return { kind: "none", reason, readability: [], judgedBodies: 0 };
	const candidateIds = params.sources.filter((source) => verdict.contentHashes.includes(source.metadata.contentHash)).map((source) => source.metadata.id);
	const [winner, ...tiedWith] = candidateIds;
	assert(winner, "a settled verdict names a body among the current candidates");
	const readability = candidateIds.map((candidateId) => ({ candidateId, readable: true }));
	return tiedWith.length > 0
		? { kind: "tie", candidateIds, reason, readability, judgedBodies: 0 }
		: { kind: "winner", candidateId: winner, reason, readability, judgedBodies: 0 };
}

export function initJudgeUnderLedger(deps: {
	selectMostCompleteContent: SelectMostCompleteContent;
	runMeteredLeg: RunMeteredLeg;
	claimTtlMs: number;
}): JudgeCandidates {
	return async ({ url, originalUrl, sources, proseHashOf, claimId }) => {
		if (sources.length === 0) return { kind: "none", reason: "no verified candidates", readability: [], judgedBodies: 0 };
		const judged: { decision?: JudgeDecision } = {};
		const ran = await deps.runMeteredLeg({
			url,
			leg: "content-judge",
			inputs: [...new Set(sources.map((source) => source.metadata.contentHash))].sort(),
			claimId,
			claimTtlMs: deps.claimTtlMs,
			run: async () => {
				const decision = await judgeCandidates({ sources, originalUrl, selectMostCompleteContent: deps.selectMostCompleteContent, proseHashOf });
				judged.decision = decision;
				return decision.audit.responseStatus === "rejected"
					? { kind: "unsucceeded" }
					: { kind: "succeeded", outcome: JSON.stringify(verdictOf({ decision, sources })) };
			},
		});
		if (ran.kind === "deferred") return { kind: "deferred", reason: "the content judge waits for a reader to open the article", readability: [], judgedBodies: 0 };
		assert(ran.kind !== "in-flight", `another delivery holds the content judge for ${url}`);
		if (ran.kind === "settled") return replayVerdict({ outcome: ran.outcome, sources });
		assert(judged.decision, "a run content judge leaves its decision");
		return judged.decision;
	};
}
