import assert from "node:assert";
import type { ArticleOpenReport } from "./article-open-latency";

export type ComparisonVerdict =
	| "below instrument resolution"
	| "within run-to-run noise"
	| "right faster"
	| "right slower";

export type ComparisonRow = {
	condition: string;
	leftMeanMs: number;
	rightMeanMs: number;
	deltaMs: number;
	resolutionMs: number;
	noiseMs: number;
	verdict: ComparisonVerdict;
};

const TWO_SIDED_95_PERCENT_Z = 1.96;

function verdictFor(input: {
	deltaMs: number;
	resolutionMs: number;
	noiseMs: number;
}): ComparisonVerdict {
	const magnitudeMs = Math.abs(input.deltaMs);
	if (magnitudeMs <= input.resolutionMs) return "below instrument resolution";
	if (magnitudeMs <= input.noiseMs) return "within run-to-run noise";
	return input.deltaMs < 0 ? "right faster" : "right slower";
}

export function compareArms(input: {
	left: ArticleOpenReport;
	right: ArticleOpenReport;
}): ComparisonRow[] {
	assert.equal(
		input.left.results.length,
		input.right.results.length,
		"both arms must have measured the same number of conditions",
	);
	return input.left.results.map((left, index) => {
		const right = input.right.results[index];
		assert.equal(
			left.condition,
			right.condition,
			"both arms must have measured the same conditions in the same order",
		);
		const deltaMs = right.stats.meanMs - left.stats.meanMs;
		const resolutionMs = Math.max(left.stats.resolutionMs, right.stats.resolutionMs);
		const noiseMs =
			TWO_SIDED_95_PERCENT_Z *
			Math.sqrt(
				left.stats.sdMs ** 2 / left.stats.count + right.stats.sdMs ** 2 / right.stats.count,
			);
		return {
			condition: left.condition,
			leftMeanMs: left.stats.meanMs,
			rightMeanMs: right.stats.meanMs,
			deltaMs,
			resolutionMs,
			noiseMs,
			verdict: verdictFor({ deltaMs, resolutionMs, noiseMs }),
		};
	});
}

function toTenth(value: number): string {
	return value.toFixed(1);
}

export function formatComparisonTable(input: {
	left: string;
	right: string;
	rows: ComparisonRow[];
}): string {
	assert(input.rows.length > 0, "a comparison table needs at least one condition");
	return [
		`| Condition | ${input.left} mean (ms) | ${input.right} mean (ms) | delta (ms) | resolution (ms) | noise (ms) | verdict |`,
		"| --- | ---: | ---: | ---: | ---: | ---: | --- |",
		...input.rows.map(
			(row) =>
				`| ${row.condition} | ${toTenth(row.leftMeanMs)} | ${toTenth(row.rightMeanMs)}` +
				` | ${toTenth(row.deltaMs)} | ${toTenth(row.resolutionMs)} | ${toTenth(row.noiseMs)}` +
				` | ${row.verdict} |`,
		),
	].join("\n");
}
