import assert from "node:assert/strict";
import path from "node:path";
import { requireEnv } from "@packages/require-env";

export type PerfSuite =
	| "simulated"
	| "chrome"
	| "firefox"
	| "chrome-save-all"
	| "firefox-save-all";

/** Every budget and sample count a perf suite runs under is declared in its own
 * project's perf config and reaches the suite through the environment, so a
 * project can be tightened without touching any other. */
export function perfSetting(name: string): number {
	const raw = requireEnv(name);
	const value = Number(raw);
	assert(
		Number.isInteger(value) && value >= 0,
		`${name} must be a whole number, got "${raw}"`,
	);
	return value;
}

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
