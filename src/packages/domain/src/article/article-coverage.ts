import { z } from "zod";

export const COVERAGE_RULE_VERSIONS = { "section-coverage": 1 } as const;
export const CoverageRuleIdSchema = z.enum(["section-coverage"]);
export type CoverageRuleId = z.infer<typeof CoverageRuleIdSchema>;

export const CoverageRuleModeSchema = z.enum(["off", "shadow", "enforce"]);
export const CoverageRuleModesSchema = z.object({ "section-coverage": CoverageRuleModeSchema }).strict();
export type CoverageRuleModes = z.infer<typeof CoverageRuleModesSchema>;
export const ALL_COVERAGE_RULES_OFF: CoverageRuleModes = { "section-coverage": "off" };

export function parseCoverageRuleModes(raw: string): CoverageRuleModes {
	return CoverageRuleModesSchema.parse(JSON.parse(raw));
}

export const CoverageReasonSchema = z.enum([
	"no-section-structure",
	"off-page-sections",
	"material-outside-region",
	"adjacent-repeated-block",
	"missing-section",
	"section-out-of-order",
	"duplicated-section",
	"missing-code",
	"table-mismatch",
	"missing-image",
	"recovery-not-verified",
	"recovery-loses-baseline-content",
	"rule-failed",
]);
export type CoverageReason = z.infer<typeof CoverageReasonSchema>;

export const CoverageScopeSchema = z.object({ kind: z.enum(["article", "chapter"]), units: z.number().int().positive() });
export type CoverageScope = z.infer<typeof CoverageScopeSchema>;

export type CoverageOutcome =
	| { outcome: "unknown"; reasons: readonly CoverageReason[] }
	| { outcome: "verified-for-scope"; scope: CoverageScope; covered: number }
	| { outcome: "known-partial"; scope: CoverageScope; covered: number; unresolved: number; reasons: readonly CoverageReason[] };

const assessed = {
	ruleId: CoverageRuleIdSchema,
	ruleVersion: z.number().int().positive(),
	mode: z.enum(["shadow", "enforce"]),
	repair: z.enum(["none", "would-apply", "applied", "regressed", "media-failed"]),
};
const reasons = z.array(CoverageReasonSchema).min(1).max(6);
export const CoverageAssessmentSchema = z.discriminatedUnion("outcome", [
	z.object({ ...assessed, outcome: z.literal("unknown"), reasons }),
	z.object({ ...assessed, outcome: z.literal("verified-for-scope"), scope: CoverageScopeSchema, covered: z.number().int().positive() }),
	z.object({
		...assessed,
		outcome: z.literal("known-partial"),
		scope: CoverageScopeSchema,
		covered: z.number().int().nonnegative(),
		unresolved: z.number().int().positive(),
		reasons,
	}),
]);
export type CoverageAssessment = z.infer<typeof CoverageAssessmentSchema>;

const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);
export const ArticleCoverageSchema = z.object({
	schemaVersion: z.literal(1),
	sourceDigest: Sha256Hex,
	outputDigest: Sha256Hex,
	assessments: z.array(CoverageAssessmentSchema).min(1).max(8),
});
export type ArticleCoverage = z.infer<typeof ArticleCoverageSchema>;

export function certifiesArticle(outcome: CoverageOutcome): boolean {
	return outcome.outcome === "verified-for-scope" && outcome.scope.kind === "article";
}

export function isConfirmedArticleLoss(outcome: CoverageOutcome): boolean {
	return outcome.outcome === "known-partial" && outcome.scope.kind === "article";
}

export function isWorseOutcome(params: { next: CoverageOutcome; previous: CoverageOutcome }): boolean {
	const { next, previous } = params;
	switch (previous.outcome) {
		case "unknown":
			return false;
		case "verified-for-scope":
			return next.outcome !== "verified-for-scope";
		case "known-partial":
			return next.outcome === "known-partial" && next.covered < previous.covered;
	}
}
