import type { CoverageInspection } from "@packages/article-parser";
import type { CoverageReason } from "@packages/domain/article";
import { buildArticleCoverage } from "./article-coverage-report";

const ABSTAINED: CoverageInspection = {
	ruleId: "section-coverage",
	ruleVersion: 1,
	mode: "shadow",
	kind: "abstained",
	reason: "no-section-structure",
};

describe("buildArticleCoverage", () => {
	it("records nothing when no rule assessed the page", () => {
		expect(
			buildArticleCoverage({ sourceHtml: "s", html: "h", plan: { entries: [], repair: undefined }, finals: [], repairStatus: "none" }),
		).toBeUndefined();
	});

	it("keeps the first five distinct reasons and the last one", () => {
		const finalReasons: CoverageReason[] = ["missing-section", "missing-code", "table-mismatch", "missing-image", "off-page-sections"];
		const entryReasons: CoverageReason[] = ["missing-section", "duplicated-section", "recovery-not-verified"];
		const coverage = buildArticleCoverage({
			sourceHtml: "s",
			html: "h",
			plan: { entries: [{ inspection: ABSTAINED, baseline: { outcome: "unknown", reasons: entryReasons }, wouldRepair: false, reasons: entryReasons }], repair: undefined },
			finals: [{ outcome: "unknown", reasons: finalReasons }],
			repairStatus: "none",
		});

		expect(coverage?.assessments).toEqual([
			{ ruleId: "section-coverage", ruleVersion: 1, mode: "shadow", repair: "none", outcome: "unknown", reasons: ["missing-section", "missing-code", "table-mismatch", "missing-image", "off-page-sections", "recovery-not-verified"] },
		]);
	});
});
