import { createHash } from "node:crypto";
import {
	ArticleCoverageSchema,
	COVERAGE_RULE_VERSIONS,
	CoverageRuleIdSchema,
	certifiesArticle,
	isConfirmedArticleLoss,
	type ArticleCoverage,
	type CandidateId,
	type CoverageAssessment,
	type CoverageRuleId,
	type CoverageRuleModes,
} from "@packages/domain/article";
import type { VerifiedTierSource } from "@packages/tier-source";

export type SelectionCoverage = {
	byCandidate: ReadonlyMap<CandidateId, ArticleCoverage>;
	excludedIds: readonly CandidateId[];
	wouldExcludeIds: readonly CandidateId[];
};

export const NO_SELECTION_COVERAGE: SelectionCoverage = { byCandidate: new Map(), excludedIds: [], wouldExcludeIds: [] };

export function readBoundCoverage(source: VerifiedTierSource): ArticleCoverage | undefined {
	const parsed = ArticleCoverageSchema.safeParse(source.metadata.coverage);
	if (!parsed.success) return undefined;
	const output = createHash("sha256").update(source.html).digest("hex");
	if (parsed.data.outputDigest !== output) return undefined;
	if (source.metadata.contentHash !== output && parsed.data.sourceDigest !== source.metadata.contentHash) return undefined;
	return parsed.data;
}

function currentAssessmentOf(params: { coverage: ArticleCoverage | undefined; ruleId: CoverageRuleId }): CoverageAssessment | undefined {
	return params.coverage?.assessments.find((assessment) => assessment.ruleId === params.ruleId && assessment.ruleVersion === COVERAGE_RULE_VERSIONS[params.ruleId]);
}

export function coverageLossesOf(params: {
	sources: readonly VerifiedTierSource[];
	modes: CoverageRuleModes;
	isReadable: (source: VerifiedTierSource) => boolean;
	isWitness: (source: VerifiedTierSource) => boolean;
	isTapCapture: (source: VerifiedTierSource) => boolean;
}): SelectionCoverage {
	const byCandidate = new Map<CandidateId, ArticleCoverage>();
	for (const source of params.sources) {
		const coverage = readBoundCoverage(source);
		if (coverage !== undefined) byCandidate.set(source.metadata.id, coverage);
	}
	const excludedIds: CandidateId[] = [];
	const wouldExcludeIds: CandidateId[] = [];
	const readable = params.sources.filter(params.isReadable);
	for (const ruleId of CoverageRuleIdSchema.options) {
		const mode = params.modes[ruleId];
		if (mode === "off") continue;
		const current = (source: VerifiedTierSource) => currentAssessmentOf({ coverage: byCandidate.get(source.metadata.id), ruleId });
		const verifiedUnits = Math.max(0, ...readable.filter(params.isWitness).map(current).flatMap((assessment) => assessment !== undefined && assessment.outcome === "verified-for-scope" && certifiesArticle(assessment) ? [assessment.scope.units] : []));
		const lossy = readable.filter((source) => {
			const assessment = current(source);
			return !params.isTapCapture(source) && assessment !== undefined && assessment.outcome === "known-partial" && isConfirmedArticleLoss(assessment) && assessment.scope.units <= verifiedUnits;
		});
		(mode === "enforce" ? excludedIds : wouldExcludeIds).push(...lossy.map((source) => source.metadata.id));
	}
	return { byCandidate, excludedIds, wouldExcludeIds };
}

export function coverageNoteOf(params: { coverage: ArticleCoverage | undefined; modes: CoverageRuleModes }): string | undefined {
	const notes = (params.coverage?.assessments ?? []).flatMap((assessment) =>
		params.modes[assessment.ruleId] === "enforce" && assessment.ruleVersion === COVERAGE_RULE_VERSIONS[assessment.ruleId] && assessment.outcome !== "unknown"
			? [`${assessment.ruleId}@${assessment.ruleVersion} ${assessment.outcome} ${assessment.covered}/${assessment.scope.units}`]
			: []);
	return notes.length > 0 ? notes.join("; ") : undefined;
}
