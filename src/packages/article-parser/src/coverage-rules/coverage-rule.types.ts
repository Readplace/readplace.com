import type { CoverageOutcome, CoverageReason, CoverageRuleId } from "@packages/domain/article";

export type MediaUrlMap = ReadonlyMap<string, string>;
export type ReaderProjection = { document: Document; media: MediaUrlMap };

type CoverageSource = { document: Document; documentUrl: string };

export type CoverageRule<Evidence> = {
	id: CoverageRuleId;
	version: number;
	inspect: (source: CoverageSource) => { kind: "evidence"; evidence: Evidence } | { kind: "abstain"; reason: CoverageReason };
	verify: (params: { evidence: Evidence; reader: ReaderProjection }) => CoverageOutcome;
	recover?: (params: { evidence: Evidence; document: Document; documentUrl: string }) => { bodyHtml: string } | undefined;
};

export type RegisteredCoverageRule = {
	id: CoverageRuleId;
	version: number;
	inspect: (
		source: CoverageSource,
	) =>
		| { kind: "abstained"; reason: CoverageReason }
		| { kind: "inspected"; verify: (reader: ReaderProjection) => CoverageOutcome; recoveredBodyHtml: string | undefined };
};

type Assessed = { ruleId: CoverageRuleId; ruleVersion: number; mode: "shadow" | "enforce" };
type VerifyReader = (params: { readerHtml: string; media: MediaUrlMap }) => CoverageOutcome;

export type SourceInspection =
	| (Assessed & { kind: "abstained"; reason: CoverageReason })
	| (Assessed & { kind: "inspected"; verify: VerifyReader; recoveredBodyHtml: string | undefined });
export type CoverageAlternative = { content: string; wordCount: number };
export type CoverageInspection =
	| (Assessed & { kind: "abstained"; reason: CoverageReason })
	| (Assessed & { kind: "inspected"; verify: VerifyReader; alternative: (() => CoverageAlternative | undefined) | undefined });

export type ActiveCoverageRules = { inspect: (source: { html: string; documentUrl: string }) => readonly SourceInspection[] };
