import assert from "node:assert/strict";
import {
	ENCROACHMENT_RATIO,
	type OpBudget,
	type OpResult,
	type ScreenResponseSample,
	budgetVerdict,
	controlProbeOf,
	formatResultsTable,
	missingOpResults,
	navigationKindOf,
	parseBudgets,
	readBudgets,
	screenResponseReportPaths,
	summarizeMs,
	summarizePhases,
	summarizeScreenResponse,
} from "./screen-response-latency";

function sameDocumentSample(elapsedMs: number, phases = {}): ScreenResponseSample {
	return {
		elapsedMs,
		matchedOneOf: "[data-test-article]",
		historyCacheHit: false,
		phases,
		sameDocument: true,
	};
}

function newDocumentSample(elapsedMs: number): ScreenResponseSample {
	return {
		elapsedMs,
		matchedOneOf: "[data-test-reader-content]",
		historyCacheHit: false,
		phases: {},
		sameDocument: false,
		responseStartMs: 180,
		activationStartMs: 0,
		fcpMs: 240,
	};
}

const lockedBudget: OpBudget = {
	level: "error",
	budgetMs: 500,
	baseline: {
		maxMs: 400,
		runs: 20,
		shas: ["84ec9a9e"],
		recordedAt: "2026-08-27T00:00:00.000Z",
	},
	note: "locked from a 20-run soak",
};

const bootstrapBudget: OpBudget = {
	level: "warn",
	budgetMs: null,
	baseline: null,
	note: "report-only until soaked",
};

describe("screen response statistics", () => {
	it("reports the maximum the gate reads, alongside the diagnostics", () => {
		const stats = summarizeMs([220, 180, 640, 300]);

		assert.equal(stats.maxMs, 640);
		assert.equal(stats.count, 4);
		assert.deepEqual(stats.sortedMs, [180, 220, 300, 640]);
	});

	it("summarises the elapsed time of every sample", () => {
		const stats = summarizeScreenResponse([
			sameDocumentSample(100),
			sameDocumentSample(300),
		]);

		assert.equal(stats.maxMs, 300);
		assert.equal(stats.meanMs, 200);
	});

	it("leaves the caller's array untouched when it sorts", () => {
		const samplesMs = [300, 100, 200];
		summarizeMs(samplesMs);

		assert.deepEqual(samplesMs, [300, 100, 200]);
	});
});

describe("navigation homogeneity", () => {
	it("reports a same-document operation when every sample stayed put", () => {
		assert.equal(
			navigationKindOf([sameDocumentSample(100), sameDocumentSample(120)]),
			"same-document",
		);
	});

	it("reports a new-document operation when every sample hopped", () => {
		assert.equal(
			navigationKindOf([newDocumentSample(400), newDocumentSample(420)]),
			"new-document",
		);
	});

	it("refuses a bucket that mixes the two, whose maximum would compare two screens", () => {
		assert.throws(
			() => navigationKindOf([sameDocumentSample(100), newDocumentSample(400)]),
			/must reach the screen the same way/,
		);
	});

	it("refuses to name the navigation of an empty bucket", () => {
		assert.throws(() => navigationKindOf([]), /at least one sample/);
	});
});

describe("phase spans", () => {
	it("averages the htmx phases that were observed", () => {
		const phases = summarizePhases([
			sameDocumentSample(300, { beforeRequestMs: 10, afterSwapMs: 200, afterSettleMs: 260 }),
			sameDocumentSample(320, { beforeRequestMs: 20, afterSwapMs: 220, afterSettleMs: 280 }),
		]);

		assert.equal(phases.beforeRequestMs, 15);
		assert.equal(phases.afterSwapMs, 210);
		assert.equal(phases.afterSettleMs, 270);
	});

	it("omits a phase no sample reached rather than reporting it as zero", () => {
		const phases = summarizePhases([sameDocumentSample(300)]);

		assert.equal(phases.beforeRequestMs, undefined);
		assert.equal(phases.responseStartMs, undefined);
	});

	it("averages the document-hop timings of a cross-document operation", () => {
		const phases = summarizePhases([newDocumentSample(400), newDocumentSample(500)]);

		assert.equal(phases.responseStartMs, 180);
		assert.equal(phases.activationStartMs, 0);
		assert.equal(phases.fcpMs, 240);
	});
});

describe("budget verdicts", () => {
	it("records a number without gating it while the budget is still bootstrapping", () => {
		const verdict = budgetVerdict({
			opId: "readlist-switch-first",
			budget: bootstrapBudget,
			stats: summarizeMs([9000]),
		});

		assert.equal(verdict.outcome, "report-only");
		assert.equal(verdict.budgetMs, null);
		assert.match(verdict.message, /report-only/);
	});

	it("passes a maximum comfortably inside the budget", () => {
		const verdict = budgetVerdict({
			opId: "open-article",
			budget: lockedBudget,
			stats: summarizeMs([200, 300, 400]),
		});

		assert.equal(verdict.outcome, "within");
	});

	it("warns once the maximum climbs past the encroachment ratio", () => {
		const encroaching = lockedBudget.budgetMs * ENCROACHMENT_RATIO + 1;
		const verdict = budgetVerdict({
			opId: "open-article",
			budget: lockedBudget,
			stats: summarizeMs([200, encroaching]),
		});

		assert.equal(verdict.outcome, "encroaching");
	});

	it("treats a maximum exactly on the budget as within it", () => {
		const verdict = budgetVerdict({
			opId: "open-article",
			budget: lockedBudget,
			stats: summarizeMs([500]),
		});

		assert.equal(verdict.outcome, "encroaching");
	});

	it("breaches only once the maximum passes the budget", () => {
		const verdict = budgetVerdict({
			opId: "open-article",
			budget: lockedBudget,
			stats: summarizeMs([200, 501]),
		});

		assert.equal(verdict.outcome, "breached");
		assert.equal(verdict.maxMs, 501);
	});

	it("names the operation and prints every sample when it breaches", () => {
		const verdict = budgetVerdict({
			opId: "back-to-readlist",
			budget: lockedBudget,
			stats: summarizeMs([700, 200]),
		});

		assert.match(verdict.message, /^back-to-readlist: max 700\.0ms exceeds the 500ms budget/);
		assert.match(verdict.message, /samples: 200, 700$/);
	});
});

describe("budgets file", () => {
	it("parses the checked-in budgets that gate every deploy", () => {
		const budgets = readBudgets(__dirname);

		assert.equal(budgets.meta.statistic, "max");
		assert.equal(budgets.meta.encroachmentRatio, ENCROACHMENT_RATIO);
		assert.equal(budgets.meta.samples.longLivedContext.measured, 20);
		assert.equal(budgets.meta.samples.freshContexts.measured, 10);
	});

	it("rejects a gating budget that carries no millisecond ceiling to gate on", () => {
		const budgets = readBudgets(__dirname);
		const broken = {
			...budgets,
			ops: {
				...budgets.ops,
				"open-article": { level: "error", budgetMs: null, baseline: null, note: "oops" },
			},
		};

		assert.throws(() => parseBudgets(broken));
	});

	it("rejects a gating budget with no baseline to compare a green run against", () => {
		const budgets = readBudgets(__dirname);
		const broken = {
			...budgets,
			ops: {
				...budgets.ops,
				"open-article": { level: "error", budgetMs: 400, baseline: null, note: "oops" },
			},
		};

		assert.throws(() => parseBudgets(broken));
	});

	it("rejects budgets that drop an operation the suite measures", () => {
		const budgets = readBudgets(__dirname);
		const { "back-to-readlist": _dropped, ...remaining } = budgets.ops;

		assert.throws(() => parseBudgets({ ...budgets, ops: remaining }));
	});
});

describe("control probe", () => {
	it("reports how much slower the same constant request got over the run", () => {
		const probe = controlProbeOf({ atStartMs: [100, 100, 100], atEndMs: [200, 200, 200] });

		assert.equal(probe.endOverStartRatio, 2);
		assert.equal(probe.atStart.p50Ms, 100);
		assert.equal(probe.atEnd.p50Ms, 200);
	});
});

describe("report", () => {
	const result: OpResult = {
		opId: "readlist-switch-subsequent",
		navigation: "same-document",
		stats: summarizeMs([180, 220]),
		phases: { beforeRequestMs: 12, afterSwapMs: 190, afterSettleMs: 205 },
		verdict: budgetVerdict({
			opId: "readlist-switch-subsequent",
			budget: lockedBudget,
			stats: summarizeMs([180, 220]),
		}),
		warmupMs: [900],
		remeasured: false,
	};

	it("puts the gated maximum and its budget in the table", () => {
		const table = formatResultsTable([result]);

		assert.match(table, /\| readlist-switch-subsequent \| same-document \| 2 \| 220\.0 \| 500 \| within \|/);
	});

	it("dashes the budget column while the operation is still report-only", () => {
		const table = formatResultsTable([
			{
				...result,
				verdict: budgetVerdict({
					opId: "readlist-switch-subsequent",
					budget: bootstrapBudget,
					stats: result.stats,
				}),
			},
		]);

		assert.match(table, /\| 220\.0 \| — \| report-only \|/);
	});

	it("dashes a phase the operation never reported instead of printing a zero", () => {
		const table = formatResultsTable([{ ...result, phases: {} }]);

		assert.match(table, /\| — \| — \| — \| — \| — \|$/m);
	});

	it("refuses to write a table with nothing measured in it", () => {
		assert.throws(() => formatResultsTable([]), /at least one operation/);
	});

	it("writes the samples and the table under the run's own commit", () => {
		const paths = screenResponseReportPaths({ outputRoot: "test-results-staging", sha: "84ec9a9e" });

		assert.equal(paths.samples, "test-results-staging/perf/screen-response-84ec9a9e.json");
		assert.equal(paths.table, "test-results-staging/perf/screen-response-84ec9a9e.md");
	});

	it("names the operations a partial run never got to", () => {
		assert.deepEqual(missingOpResults([result]), [
			"readlist-switch-first",
			"tab-switch-first",
			"tab-switch-subsequent",
			"assign-to-readlist",
			"open-article",
			"back-to-readlist",
		]);
	});
});
