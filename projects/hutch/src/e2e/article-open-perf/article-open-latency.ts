import assert from "node:assert";
import path from "node:path";

export type ArticleOpenSample = {
	elapsedMs: number;
	documentHopMs: number;
	sameDocument: boolean;
};

export type NavigationKind = "same-document" | "new-document";

export type LatencyStats = {
	count: number;
	meanMs: number;
	sdMs: number;
	p50Ms: number;
	minMs: number;
	maxMs: number;
};

export type ConditionResult = {
	condition: string;
	navigation: NavigationKind;
	stats: LatencyStats;
};

export function summarizeLatency(samplesMs: number[]): LatencyStats {
	assert(
		samplesMs.length >= 2,
		"a latency summary needs at least two samples to carry a standard deviation",
	);
	const sorted = [...samplesMs].sort((left, right) => left - right);
	const meanMs = sorted.reduce((sum, sample) => sum + sample, 0) / sorted.length;
	const variance =
		sorted.reduce((sum, sample) => sum + (sample - meanMs) ** 2, 0) /
		(sorted.length - 1);
	return {
		count: sorted.length,
		meanMs,
		sdMs: Math.sqrt(variance),
		p50Ms: sorted[Math.ceil(sorted.length / 2) - 1],
		minMs: sorted[0],
		maxMs: sorted[sorted.length - 1],
	};
}

export function splitWarmup<TSample>(input: {
	samples: TSample[];
	warmups: number;
}): { warmup: TSample[]; measured: TSample[] } {
	assert(
		input.samples.length > input.warmups,
		`a condition needs more than ${input.warmups} samples to report anything past its warm-ups`,
	);
	return {
		warmup: input.samples.slice(0, input.warmups),
		measured: input.samples.slice(input.warmups),
	};
}

/** The one arm-detecting statement in the harness: a run against a boosted build
 * must report every open as same-document and a run against an unboosted one
 * every open as new-document. A condition that reports both measured two
 * different things and its mean would average them. */
export function navigationKindOf(samples: ArticleOpenSample[]): NavigationKind {
	assert(samples.length > 0, "a navigation kind needs at least one sample");
	const sameDocument = samples.every((sample) => sample.sameDocument);
	const newDocument = samples.every((sample) => !sample.sameDocument);
	assert(
		sameDocument !== newDocument,
		"every sample in a condition must open the article the same way",
	);
	return sameDocument ? "same-document" : "new-document";
}

function toTenth(value: number): string {
	return value.toFixed(1);
}

export function formatResultsTable(results: ConditionResult[]): string {
	assert(results.length > 0, "a results table needs at least one condition");
	return [
		"| Condition | Open | n | mean (ms) | sd (ms) | p50 (ms) |",
		"| --- | --- | ---: | ---: | ---: | ---: |",
		...results.map(
			(result) =>
				`| ${result.condition} | ${result.navigation} | ${result.stats.count}` +
				` | ${toTenth(result.stats.meanMs)} | ${toTenth(result.stats.sdMs)}` +
				` | ${toTenth(result.stats.p50Ms)} |`,
		),
	].join("\n");
}

/** The table is written beside the samples it was computed from so a published
 * number can be traced back to the run that produced it. */
export function articleOpenReportPaths(input: {
	root: string | undefined;
	runId: string | undefined;
	label: string;
}): { samples: string; table: string } {
	const directory =
		input.root === undefined
			? path.join("test-results", "perf")
			: path.join(input.root, input.runId ?? "local", "perf");
	return {
		samples: path.join(directory, `${input.label}-article-open-latency.json`),
		table: path.join(directory, `${input.label}-article-open-latency.md`),
	};
}
