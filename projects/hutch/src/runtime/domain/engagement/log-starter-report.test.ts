import assert from "node:assert/strict";
import type { HutchLogger } from "@packages/hutch-logger";
import { initLogStarterReport, type StarterReportLine } from "./log-starter-report";
import type { ArmCounts, StarterReport } from "./starter-report";

const NOW = new Date("2026-11-20T10:00:00.000Z");

function counts(overrides: Partial<ArmCounts>): ArmCounts {
	return {
		assigned: 0,
		mature: 0,
		immature: 0,
		activated: 0,
		inserted: 0,
		insertionFailed: 0,
		sent: 0,
		suppressed: 0,
		review: 0,
		engagedDays8To14: 0,
		...overrides,
	};
}

const REPORT: StarterReport = {
	campaignId: "hn-starter-v1",
	formalReviewDue: true,
	enrollmentStart: "2026-10-09T10:27:53.370Z",
	enrollmentEnd: "2026-11-06T10:27:53.370Z",
	arms: {
		treatment: counts({ assigned: 40, mature: 40, activated: 12, inserted: 39, sent: 35 }),
		comparison: counts({ assigned: 10, mature: 10, activated: 1 }),
	},
	cohorts: {
		"trial/new": {
			treatment: counts({ assigned: 30, mature: 30, activated: 10 }),
			comparison: counts({ assigned: 8, mature: 8, activated: 1 }),
		},
		"paid/existing": {
			treatment: counts({ assigned: 10, mature: 10, activated: 2 }),
			comparison: counts({ assigned: 2, mature: 2 }),
		},
	},
	intervals: { treatment: [0.18, 0.45], comparison: [0.02, 0.4] },
	absoluteActivationDifference: 0.2,
	differenceInterval: [-0.052345, 0.333912],
	intervalMethod: "Wilson/Newcombe 95%",
	twoSidedFisherPValue: 0.4123,
	significanceLevel: 0.05,
	conclusion: "inconclusive",
};

function useLogStarterReport(report: StarterReport | undefined) {
	const lines: StarterReportLine[] = [];
	const capture = (line: StarterReportLine) => {
		lines.push(line);
	};
	const logger: HutchLogger.Typed<StarterReportLine> = {
		info: capture,
		warn: capture,
		error: capture,
		debug: capture,
	};
	const logStarterReport = initLogStarterReport({
		getStarterReport: async () => report,
		logger,
		now: () => NOW,
	});
	return { lines, logStarterReport };
}

describe("initLogStarterReport", () => {
	it("logs the whole-experiment result as one analytics line", async () => {
		const { lines, logStarterReport } = useLogStarterReport(REPORT);

		await logStarterReport();

		assert.deepEqual(lines[0], {
			stream: "analytics",
			event: "starter_report",
			timestamp: NOW.toISOString(),
			campaign_id: "hn-starter-v1",
			cohort: "all",
			treatment: REPORT.arms.treatment,
			comparison: REPORT.arms.comparison,
			formal_review_due: true,
			enrollment_start: "2026-10-09T10:27:53.370Z",
			enrollment_end: "2026-11-06T10:27:53.370Z",
			difference_pp: 20,
			ci_low_pp: -5.23,
			ci_high_pp: 33.39,
			interval_method: "Wilson/Newcombe 95%",
			fisher_p: 0.4123,
			significance_level: 0.05,
			conclusion: "inconclusive",
		});
	});

	it("logs one line per cohort with both arms' counts", async () => {
		const { lines, logStarterReport } = useLogStarterReport(REPORT);

		await logStarterReport();

		assert.deepEqual(lines.slice(1), [
			{
				stream: "analytics",
				event: "starter_report",
				timestamp: NOW.toISOString(),
				campaign_id: "hn-starter-v1",
				cohort: "trial/new",
				treatment: REPORT.cohorts["trial/new"]?.treatment,
				comparison: REPORT.cohorts["trial/new"]?.comparison,
			},
			{
				stream: "analytics",
				event: "starter_report",
				timestamp: NOW.toISOString(),
				campaign_id: "hn-starter-v1",
				cohort: "paid/existing",
				treatment: REPORT.cohorts["paid/existing"]?.treatment,
				comparison: REPORT.cohorts["paid/existing"]?.comparison,
			},
		]);
	});

	it("logs nothing before the experiment has a rollout", async () => {
		const { lines, logStarterReport } = useLogStarterReport(undefined);

		await logStarterReport();

		assert.deepEqual(lines, []);
	});
});
