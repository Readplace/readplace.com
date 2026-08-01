import assert from "node:assert/strict";
import path from "node:path";

export type PerfSuite = "simulated" | "chrome" | "firefox";

/** 1. Measured, not chosen. Each browser budget is ~2.8x the slowest run mean
 *     over 20 independent github-hosted runs, which is ~12 standard deviations
 *     of run-to-run spread above the average one — far enough out that a
 *     breach means the save got slower, not that the runner did. Re-derive
 *     them with the perf soak workflow when the runner image, the browsers, or
 *     the save path itself moves. Chrome and Firefox are apart because Firefox
 *     measured 1.7x slower with 2.3x the spread, and one budget covering both
 *     would let a 5x Chrome regression through.
 *  2. The simulated suite has no clock and no variance, so its budget is not a
 *     safety margin: it is one simulated round trip above the costliest
 *     scenario, so a save that grows by a single request fails it. */
export const SAVE_LATENCY_BUDGET_MS: Record<PerfSuite, number> = {
	simulated: 400 /* 2 */,
	chrome: 150 /* 1 */,
	firefox: 250 /* 1 */,
};

export type LatencySummary = {
	count: number;
	meanMs: number;
	p50Ms: number;
	p95Ms: number;
	maxMs: number;
};

function nearestRank(sorted: number[], percentile: number): number {
	const rank = Math.ceil((percentile / 100) * sorted.length);
	return sorted[rank - 1];
}

export function summarizeLatency(samplesMs: number[]): LatencySummary {
	assert(samplesMs.length > 0, "a latency summary needs at least one sample");
	const sorted = [...samplesMs].sort((left, right) => left - right);
	const total = sorted.reduce((sum, sample) => sum + sample, 0);
	return {
		count: sorted.length,
		meanMs: total / sorted.length,
		p50Ms: nearestRank(sorted, 50),
		p95Ms: nearestRank(sorted, 95),
		maxMs: sorted[sorted.length - 1],
	};
}

export function latencyReportPath(input: {
	root: string | undefined;
	runId: string | undefined;
	suite: PerfSuite;
}): string {
	const file = `${input.suite}-save-latency.json`;
	if (input.root === undefined) return path.join("test-results", "perf", file);
	return path.join(input.root, input.runId ?? "local", "perf", file);
}
