import type { CoverageOutcome } from "@packages/domain/article";
import type { CoverageAlternative, CoverageInspection } from "./coverage-rule.types";
import { planCoverageRepair } from "./plan-coverage-repair";

const BASELINE = "<p>The first eight words of the kept introduction stay here.</p><p>short</p>";
const KEEPING = `${BASELINE}<p>The recovered section the baseline lost.</p>`;
const LOSING = "<p>The recovered section the baseline lost.</p>";
const scope = { kind: "article" as const, units: 3 };
const VERIFIED: CoverageOutcome = { outcome: "verified-for-scope", scope, covered: 3 };
const PARTIAL: CoverageOutcome = { outcome: "known-partial", scope, covered: 1, unresolved: 2, reasons: ["missing-section"] };

function inspected(params: {
	mode?: "shadow" | "enforce";
	outcomes: Readonly<Record<string, CoverageOutcome>>;
	alternative?: (() => CoverageAlternative | undefined) | undefined;
}): CoverageInspection {
	return {
		ruleId: "section-coverage",
		ruleVersion: 1,
		mode: params.mode ?? "enforce",
		kind: "inspected",
		verify: ({ readerHtml }) => params.outcomes[readerHtml],
		alternative: params.alternative,
	};
}

const lossy = (params: { content: string; mode?: "shadow" | "enforce"; altOutcome?: CoverageOutcome }) =>
	inspected({
		mode: params.mode,
		outcomes: { [BASELINE]: PARTIAL, [params.content]: params.altOutcome ?? VERIFIED },
		alternative: () => ({ content: params.content, wordCount: 20 }),
	});

describe("planCoverageRepair", () => {
	it("records an abstention as unknown with its reason", () => {
		const inspection: CoverageInspection = {
			ruleId: "section-coverage",
			ruleVersion: 1,
			mode: "enforce",
			kind: "abstained",
			reason: "no-section-structure",
		};
		expect(planCoverageRepair({ baselineContent: BASELINE, inspections: [inspection] })).toEqual({
			entries: [
				{
					inspection,
					baseline: { outcome: "unknown", reasons: ["no-section-structure"] },
					wouldRepair: false,
					reasons: ["no-section-structure"],
				},
			],
			repair: undefined,
		});
	});

	it.each<[string, CoverageOutcome]>([
		["a verified baseline", VERIFIED],
		["an unknown baseline", { outcome: "unknown", reasons: ["rule-failed"] }],
		["a partial chapter", { ...PARTIAL, scope: { kind: "chapter", units: 3 } }],
	])("never materialises an alternative for %s", (_, outcome) => {
		const alternative = jest.fn(() => ({ content: KEEPING, wordCount: 20 }));
		const plan = planCoverageRepair({
			baselineContent: BASELINE,
			inspections: [inspected({ outcomes: { [BASELINE]: outcome }, alternative })],
		});
		expect(alternative).not.toHaveBeenCalled();
		expect(plan.entries[0]).toMatchObject({ baseline: outcome, wouldRepair: false });
		expect(plan.repair).toBeUndefined();
	});

	it.each([
		["no alternative", undefined],
		["an alternative that could not be materialised", () => undefined],
	])("keeps the baseline's reasons when there is %s", (_, alternative) => {
		const plan = planCoverageRepair({
			baselineContent: BASELINE,
			inspections: [inspected({ outcomes: { [BASELINE]: PARTIAL }, alternative })],
		});
		expect(plan.entries[0]).toMatchObject({ wouldRepair: false, reasons: ["missing-section"] });
		expect(plan.repair).toBeUndefined();
	});

	it("refuses an alternative that does not verify", () => {
		const plan = planCoverageRepair({ baselineContent: BASELINE, inspections: [lossy({ content: KEEPING, altOutcome: PARTIAL })] });
		expect(plan.entries[0]).toMatchObject({ wouldRepair: false, reasons: ["missing-section", "recovery-not-verified"] });
		expect(plan.repair).toBeUndefined();
	});

	it.each([
		["does not verify", { altOutcome: PARTIAL, content: KEEPING }, "recovery-not-verified"],
		["loses a run of the baseline", { content: LOSING }, "recovery-loses-baseline-content"],
	] as const)("keeps the decision within six reasons when an alternative %s after six baseline reasons", (_, alt, decision) => {
		const everyVerifyReason: CoverageOutcome = {
			outcome: "known-partial",
			scope,
			covered: 0,
			unresolved: 3,
			reasons: ["duplicated-section", "missing-code", "missing-image", "missing-section", "section-out-of-order", "table-mismatch"],
		};
		const plan = planCoverageRepair({
			baselineContent: BASELINE,
			inspections: [
				inspected({
					outcomes: { [BASELINE]: everyVerifyReason, [alt.content]: "altOutcome" in alt ? alt.altOutcome : VERIFIED },
					alternative: () => ({ content: alt.content, wordCount: 20 }),
				}),
			],
		});
		expect(plan.entries[0]).toMatchObject({
			wouldRepair: false,
			reasons: ["duplicated-section", "missing-code", "missing-image", "missing-section", "section-out-of-order", decision],
		});
	});

	it("refuses an alternative that loses a run of the baseline", () => {
		const plan = planCoverageRepair({ baselineContent: BASELINE, inspections: [lossy({ content: LOSING })] });
		expect(plan.entries[0]).toMatchObject({ wouldRepair: false, reasons: ["missing-section", "recovery-loses-baseline-content"] });
	});

	it("would repair in shadow without choosing the alternative", () => {
		const plan = planCoverageRepair({ baselineContent: BASELINE, inspections: [lossy({ content: KEEPING, mode: "shadow" })] });
		expect(plan.entries[0]).toMatchObject({ wouldRepair: true, reasons: ["missing-section"] });
		expect(plan.repair).toBeUndefined();
	});

	it("repairs with the first enforcing rule that would repair", () => {
		const second = `${KEEPING}<p>second</p>`;
		const plan = planCoverageRepair({
			baselineContent: BASELINE,
			inspections: [
				lossy({ content: KEEPING, mode: "shadow" }),
				lossy({ content: second }),
				lossy({ content: `${KEEPING}<p>third</p>` }),
			],
		});
		expect(plan.repair).toEqual({ index: 1, alternative: { content: second, wordCount: 20 } });
	});
});
