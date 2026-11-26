import {
	type CoverageOutcome,
	type CoverageReason,
	certifiesArticle,
	isConfirmedArticleLoss,
} from "@packages/domain/article";
import type { CoverageAlternative, CoverageInspection, MediaUrlMap } from "./coverage-rule.types";
import { projectReaderHtml } from "./reader-projection";
import { WORD_WINDOW } from "./section-thresholds";
import { MAX_REASONS, readerBlocks } from "./section-verify";
import { candidateKeys, indexOfKey, stream, tokenCount } from "./text-keys";

const NO_MEDIA: MediaUrlMap = new Map();

type CoverageRepairEntry = {
	inspection: CoverageInspection;
	baseline: CoverageOutcome;
	wouldRepair: boolean;
	reasons: readonly CoverageReason[];
};

function keepsBaselineContent(params: { baselineContent: string; alternativeContent: string }): boolean {
	const baselineRuns = readerBlocks(projectReaderHtml({ html: params.baselineContent, media: NO_MEDIA })).flatMap((block) =>
		block.kind === "text" && tokenCount(block.text) >= WORD_WINDOW ? [block.text] : [],
	);
	const alternativeStream = stream(readerBlocks(projectReaderHtml({ html: params.alternativeContent, media: NO_MEDIA })));
	return baselineRuns.every((run) => indexOfKey({ stream: alternativeStream, key: candidateKeys(run).keys[0], from: 0 }) >= 0);
}

function withDecision(params: { reasons: readonly CoverageReason[]; decision: CoverageReason }): readonly CoverageReason[] {
	return [...params.reasons.slice(0, MAX_REASONS - 1), params.decision];
}

function outcomeReasons(outcome: CoverageOutcome): readonly CoverageReason[] {
	return outcome.outcome === "verified-for-scope" ? [] : outcome.reasons;
}

function planEntry(params: { baselineContent: string; inspection: CoverageInspection }): {
	entry: CoverageRepairEntry;
	alternative: CoverageAlternative | undefined;
} {
	const { inspection } = params;
	if (inspection.kind === "abstained") {
		const reasons = [inspection.reason];
		return { entry: { inspection, baseline: { outcome: "unknown", reasons }, wouldRepair: false, reasons }, alternative: undefined };
	}
	const baseline = inspection.verify({ readerHtml: params.baselineContent, media: NO_MEDIA });
	const reasons = outcomeReasons(baseline);
	const alternative = isConfirmedArticleLoss(baseline) ? inspection.alternative?.() : undefined;
	if (alternative === undefined) {
		return { entry: { inspection, baseline, wouldRepair: false, reasons }, alternative: undefined };
	}
	if (!certifiesArticle(inspection.verify({ readerHtml: alternative.content, media: NO_MEDIA }))) {
		return {
			entry: { inspection, baseline, wouldRepair: false, reasons: withDecision({ reasons, decision: "recovery-not-verified" }) },
			alternative,
		};
	}
	if (!keepsBaselineContent({ baselineContent: params.baselineContent, alternativeContent: alternative.content })) {
		return {
			entry: { inspection, baseline, wouldRepair: false, reasons: withDecision({ reasons, decision: "recovery-loses-baseline-content" }) },
			alternative,
		};
	}
	return { entry: { inspection, baseline, wouldRepair: true, reasons }, alternative };
}

export function planCoverageRepair(params: { baselineContent: string; inspections: readonly CoverageInspection[] }): {
	entries: readonly CoverageRepairEntry[];
	repair: { index: number; alternative: CoverageAlternative } | undefined;
} {
	const planned = params.inspections.map((inspection) => planEntry({ baselineContent: params.baselineContent, inspection }));
	const index = planned.findIndex(({ entry }) => entry.wouldRepair && entry.inspection.mode === "enforce");
	const chosen = planned[index]?.alternative;
	return {
		entries: planned.map(({ entry }) => entry),
		repair: chosen === undefined ? undefined : { index, alternative: chosen },
	};
}
