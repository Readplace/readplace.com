import {
	type ArticleOpenSample,
	articleOpenReportPaths,
	formatResultsTable,
	navigationKindOf,
	splitWarmup,
	summarizeArticleOpen,
	summarizeDocumentHop,
} from "./article-open-latency";

function boostedSample(input: {
	elapsedMs: number;
	resolutionMs?: number;
}): ArticleOpenSample {
	return {
		elapsedMs: input.elapsedMs,
		resolutionMs: input.resolutionMs ?? 16,
		sameDocument: true,
	};
}

function navigatedSample(input: {
	elapsedMs: number;
	resolutionMs?: number;
	unloadEventMs?: number;
	preRequestMs?: number;
}): ArticleOpenSample {
	return {
		elapsedMs: input.elapsedMs,
		resolutionMs: input.resolutionMs ?? 16,
		sameDocument: false,
		unloadEventMs: input.unloadEventMs ?? 0.2,
		preRequestMs: input.preRequestMs ?? 1.5,
	};
}

describe("summarizeArticleOpen", () => {
	it("summarizes an unsorted sample set with its spread and tail", () => {
		expect(
			summarizeArticleOpen([
				boostedSample({ elapsedMs: 120 }),
				boostedSample({ elapsedMs: 100 }),
				boostedSample({ elapsedMs: 140 }),
			]),
		).toEqual({
			count: 3,
			meanMs: 120,
			sdMs: 20,
			p50Ms: 120,
			p95Ms: 140,
			maxMs: 140,
			resolutionMs: 16,
		});
	});

	it("reports the instrument resolution the samples were observed at", () => {
		expect(
			summarizeArticleOpen([
				boostedSample({ elapsedMs: 200, resolutionMs: 8 }),
				boostedSample({ elapsedMs: 200, resolutionMs: 24 }),
			]).resolutionMs,
		).toBe(16);
	});

	it("reports no spread for samples that all cost the same", () => {
		expect(
			summarizeArticleOpen([
				boostedSample({ elapsedMs: 200 }),
				boostedSample({ elapsedMs: 200 }),
			]).sdMs,
		).toBe(0);
	});

	it("refuses a single sample, which carries no standard deviation", () => {
		expect(() => summarizeArticleOpen([boostedSample({ elapsedMs: 250 })])).toThrow(
			"an article-open summary needs at least two samples to carry a standard deviation",
		);
	});
});

describe("summarizeDocumentHop", () => {
	it("averages the unload and pre-request cost the destination's navigation entry carries", () => {
		expect(
			summarizeDocumentHop([
				navigatedSample({ elapsedMs: 300, unloadEventMs: 1, preRequestMs: 2 }),
				navigatedSample({ elapsedMs: 320, unloadEventMs: 3, preRequestMs: 4 }),
			]),
		).toEqual({ unloadEventMeanMs: 2, preRequestMeanMs: 3 });
	});

	it("reports no hop for an arm that never left the document", () => {
		expect(
			summarizeDocumentHop([
				boostedSample({ elapsedMs: 100 }),
				boostedSample({ elapsedMs: 110 }),
			]),
		).toBeUndefined();
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
				boostedSample({ elapsedMs: 100 }),
				boostedSample({ elapsedMs: 110 }),
			]),
		).toBe("same-document");
	});

	it("reports an unboosted arm, where the article arrives in a new document", () => {
		expect(
			navigationKindOf([
				navigatedSample({ elapsedMs: 100 }),
				navigatedSample({ elapsedMs: 110 }),
			]),
		).toBe("new-document");
	});

	it("refuses a condition whose samples opened the article two different ways", () => {
		expect(() =>
			navigationKindOf([
				boostedSample({ elapsedMs: 100 }),
				navigatedSample({ elapsedMs: 110 }),
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
						p95Ms: 172.25,
						maxMs: 180,
						resolutionMs: 16.72,
					},
					hop: { unloadEventMeanMs: 0.24, preRequestMeanMs: 1.55 },
				},
				{
					condition: "slow-mobile-large",
					navigation: "same-document",
					stats: {
						count: 20,
						meanMs: 612.5,
						sdMs: 41,
						p50Ms: 600,
						p95Ms: 700,
						maxMs: 720,
						resolutionMs: 16.7,
					},
					hop: undefined,
				},
			]),
		).toBe(
			[
				"| Condition | Open | n | mean (ms) | sd (ms) | p50 (ms) | p95 (ms) | resolution (ms) | unload (ms) | pre-request (ms) |",
				"| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
				"| loopback-cpu1x-small | new-document | 20 | 141.3 | 9.0 | 139.5 | 172.3 | 16.7 | 0.2 | 1.6 |",
				"| slow-mobile-large | same-document | 20 | 612.5 | 41.0 | 600.0 | 700.0 | 16.7 | — | — |",
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
