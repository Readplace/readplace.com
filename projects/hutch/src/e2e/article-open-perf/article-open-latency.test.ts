import {
	articleOpenReportPaths,
	formatResultsTable,
	navigationKindOf,
	splitWarmup,
	summarizeLatency,
} from "./article-open-latency";

function sample(input: { elapsedMs: number; sameDocument: boolean }) {
	return { elapsedMs: input.elapsedMs, documentHopMs: 12, sameDocument: input.sameDocument };
}

describe("summarizeLatency", () => {
	it("summarizes an unsorted sample set with its spread", () => {
		expect(summarizeLatency([120, 100, 140])).toEqual({
			count: 3,
			meanMs: 120,
			sdMs: 20,
			p50Ms: 120,
			minMs: 100,
			maxMs: 140,
		});
	});

	it("reports no spread for samples that all cost the same", () => {
		expect(summarizeLatency([200, 200])).toEqual({
			count: 2,
			meanMs: 200,
			sdMs: 0,
			p50Ms: 200,
			minMs: 200,
			maxMs: 200,
		});
	});

	it("takes a real sample as the median of an even sample set rather than interpolating", () => {
		expect(summarizeLatency([100, 200, 300, 400]).p50Ms).toBe(200);
	});

	it("refuses a single sample, which carries no standard deviation", () => {
		expect(() => summarizeLatency([250])).toThrow(
			"a latency summary needs at least two samples to carry a standard deviation",
		);
	});
});

describe("splitWarmup", () => {
	it("discards the leading warm-ups and keeps the rest", () => {
		expect(splitWarmup({ samples: [1, 2, 3, 4, 5], warmups: 2 })).toEqual({
			warmup: [1, 2],
			measured: [3, 4, 5],
		});
	});

	it("keeps every sample when a run declares no warm-ups", () => {
		expect(splitWarmup({ samples: [1, 2], warmups: 0 })).toEqual({
			warmup: [],
			measured: [1, 2],
		});
	});

	it("refuses a run whose samples are all warm-ups", () => {
		expect(() => splitWarmup({ samples: [1, 2], warmups: 2 })).toThrow(
			"a condition needs more than 2 samples to report anything past its warm-ups",
		);
	});
});

describe("navigationKindOf", () => {
	it("reports a boosted arm, where the article arrives in the queue's own document", () => {
		expect(
			navigationKindOf([
				sample({ elapsedMs: 100, sameDocument: true }),
				sample({ elapsedMs: 110, sameDocument: true }),
			]),
		).toBe("same-document");
	});

	it("reports an unboosted arm, where the article arrives in a new document", () => {
		expect(
			navigationKindOf([
				sample({ elapsedMs: 100, sameDocument: false }),
				sample({ elapsedMs: 110, sameDocument: false }),
			]),
		).toBe("new-document");
	});

	it("refuses a condition whose samples opened the article two different ways", () => {
		expect(() =>
			navigationKindOf([
				sample({ elapsedMs: 100, sameDocument: true }),
				sample({ elapsedMs: 110, sameDocument: false }),
			]),
		).toThrow("every sample in a condition must open the article the same way");
	});

	it("refuses to name the navigation of a condition that produced nothing", () => {
		expect(() => navigationKindOf([])).toThrow(
			"a navigation kind needs at least one sample",
		);
	});
});

describe("formatResultsTable", () => {
	it("renders one row per condition, rounded to a tenth of a millisecond", () => {
		expect(
			formatResultsTable([
				{
					condition: "loopback-cpu1x-small",
					navigation: "new-document",
					stats: {
						count: 20,
						meanMs: 141.26,
						sdMs: 9.043,
						p50Ms: 139.5,
						minMs: 120,
						maxMs: 180,
					},
				},
				{
					condition: "slow-mobile-large",
					navigation: "same-document",
					stats: {
						count: 20,
						meanMs: 612.5,
						sdMs: 41,
						p50Ms: 600,
						minMs: 540,
						maxMs: 720,
					},
				},
			]),
		).toBe(
			[
				"| Condition | Open | n | mean (ms) | sd (ms) | p50 (ms) |",
				"| --- | --- | ---: | ---: | ---: | ---: |",
				"| loopback-cpu1x-small | new-document | 20 | 141.3 | 9.0 | 139.5 |",
				"| slow-mobile-large | same-document | 20 | 612.5 | 41.0 | 600.0 |",
			].join("\n"),
		);
	});

	it("refuses to render a table for a run that measured nothing", () => {
		expect(() => formatResultsTable([])).toThrow(
			"a results table needs at least one condition",
		);
	});
});

describe("articleOpenReportPaths", () => {
	it("names both reports after the arm they measured, in the project's results directory", () => {
		expect(
			articleOpenReportPaths({ root: undefined, runId: undefined, label: "baseline" }),
		).toEqual({
			samples: "test-results/perf/baseline-article-open-latency.json",
			table: "test-results/perf/baseline-article-open-latency.md",
		});
	});

	it("keys a report under the run it came from when an artifact root is set", () => {
		expect(
			articleOpenReportPaths({ root: "/frames", runId: "4242", label: "boosted" }),
		).toEqual({
			samples: "/frames/4242/perf/boosted-article-open-latency.json",
			table: "/frames/4242/perf/boosted-article-open-latency.md",
		});
	});

	it("files a report with no run id under a local run", () => {
		expect(
			articleOpenReportPaths({ root: "/frames", runId: undefined, label: "boosted" }),
		).toEqual({
			samples: "/frames/local/perf/boosted-article-open-latency.json",
			table: "/frames/local/perf/boosted-article-open-latency.md",
		});
	});
});
