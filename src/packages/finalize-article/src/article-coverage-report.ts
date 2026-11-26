import assert from "node:assert";
import { createHash } from "node:crypto";
import type { planCoverageRepair } from "@packages/article-parser";
import type { ArticleCoverage, CoverageAssessment, CoverageOutcome, CoverageReason } from "@packages/domain/article";

const MAX_PERSISTED_REASONS = 6;

export type CoverageRepairStatus = "none" | "applied" | "regressed" | "media-failed";

type CoverageRepairPlan = ReturnType<typeof planCoverageRepair>;

function sha256(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

function mergedReasons(params: { outcome: readonly CoverageReason[]; decision: readonly CoverageReason[] }): CoverageReason[] {
	const merged = [...new Set([...params.outcome, ...params.decision])];
	return merged.length <= MAX_PERSISTED_REASONS ? merged : [...merged.slice(0, MAX_PERSISTED_REASONS - 1), ...merged.slice(-1)];
}

function assessmentOf(params: {
	final: CoverageOutcome;
	entryReasons: readonly CoverageReason[];
	assessed: Pick<CoverageAssessment, "ruleId" | "ruleVersion" | "mode" | "repair">;
}): CoverageAssessment {
	const { final, assessed } = params;
	if (final.outcome === "verified-for-scope") {
		return { ...assessed, outcome: final.outcome, scope: final.scope, covered: final.covered };
	}
	const reasons = mergedReasons({ outcome: final.reasons, decision: params.entryReasons });
	if (final.outcome === "unknown") {
		return { ...assessed, outcome: final.outcome, reasons };
	}
	return { ...assessed, outcome: final.outcome, scope: final.scope, covered: final.covered, unresolved: final.unresolved, reasons };
}

export function buildArticleCoverage(params: {
	sourceHtml: string;
	html: string;
	plan: CoverageRepairPlan;
	finals: readonly CoverageOutcome[];
	repairStatus: CoverageRepairStatus;
}): ArticleCoverage | undefined {
	const { plan } = params;
	if (plan.entries.length === 0) {
		return undefined;
	}
	const assessments = plan.entries.map((entry, index) => {
		const final = params.finals[index];
		assert(final, "every planned entry has a final outcome");
		const repair =
			index === plan.repair?.index ? params.repairStatus : entry.wouldRepair ? "would-apply" : "none";
		return assessmentOf({
			final,
			entryReasons: entry.reasons,
			assessed: { ruleId: entry.inspection.ruleId, ruleVersion: entry.inspection.ruleVersion, mode: entry.inspection.mode, repair },
		});
	});
	return { schemaVersion: 1, sourceDigest: sha256(params.sourceHtml), outputDigest: sha256(params.html), assessments };
}
