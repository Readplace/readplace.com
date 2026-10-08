import type { HutchLogger } from "@packages/hutch-logger";
import { ENGAGEMENT_EVENTS } from "./engagement-events";
import type { ArmCounts, StarterReport } from "./starter-report";

export interface StarterReportLine {
	stream: "analytics";
	event: typeof ENGAGEMENT_EVENTS.report;
	timestamp: string;
	campaign_id: string;
	cohort: string;
	treatment: ArmCounts;
	comparison: ArmCounts;
	formal_review_due?: boolean;
	enrollment_start?: string;
	enrollment_end?: string;
	difference_pp?: number;
	ci_low_pp?: number;
	ci_high_pp?: number;
	interval_method?: string;
	fisher_p?: number;
	significance_level?: number;
	conclusion?: string;
}

function percentagePoints(proportion: number): number {
	return Math.round(proportion * 10_000) / 100;
}

export function initLogStarterReport(deps: {
	getStarterReport: () => Promise<StarterReport | undefined>;
	logger: HutchLogger.Typed<StarterReportLine>;
	now: () => Date;
}) {
	return async () => {
		const report = await deps.getStarterReport();
		if (report === undefined) return;
		const common = {
			stream: "analytics",
			event: ENGAGEMENT_EVENTS.report,
			timestamp: deps.now().toISOString(),
			campaign_id: report.campaignId,
		} as const;
		deps.logger.info({
			...common,
			cohort: "all",
			treatment: report.arms.treatment,
			comparison: report.arms.comparison,
			formal_review_due: report.formalReviewDue,
			enrollment_start: report.enrollmentStart,
			enrollment_end: report.enrollmentEnd,
			difference_pp: percentagePoints(report.absoluteActivationDifference),
			ci_low_pp: percentagePoints(report.differenceInterval[0]),
			ci_high_pp: percentagePoints(report.differenceInterval[1]),
			interval_method: report.intervalMethod,
			fisher_p: report.twoSidedFisherPValue,
			significance_level: report.significanceLevel,
			conclusion: report.conclusion,
		});
		for (const [cohort, arms] of Object.entries(report.cohorts)) {
			deps.logger.info({ ...common, cohort, treatment: arms.treatment, comparison: arms.comparison });
		}
	};
}
