import assert from "node:assert/strict";
import path from "node:path";

export const SAVE_LATENCY_BUDGET_MS = 1000;

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
	suite: string;
}): string {
	const file = `${input.suite}-save-latency.json`;
	if (input.root === undefined) return path.join("test-results", "perf", file);
	return path.join(input.root, input.runId ?? "local", "perf", file);
}
