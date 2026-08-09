import { compareArms, formatComparisonTable } from "./article-open-comparison";
import type { ArticleOpenReport } from "./article-open-latency";

function arm(input: {
	label: string;
	condition?: string;
	meanMs: number;
	sdMs?: number;
	resolutionMs?: number;
	count?: number;
}): ArticleOpenReport {
	return {
		label: input.label,
		results: [
			{
				condition: input.condition ?? "loopback-cpu1x-small",
				navigation: "new-document",
				stats: {
					count: input.count ?? 20,
					meanMs: input.meanMs,
					sdMs: input.sdMs ?? 1,
					p50Ms: input.meanMs,
					p95Ms: input.meanMs,
					maxMs: input.meanMs,
					resolutionMs: input.resolutionMs ?? 16,
				},
			},
		],
	};
}

describe("compareArms", () => {
	it("refuses to attribute a gap the instrument cannot see", () => {
		const [row] = compareArms({
			left: arm({ label: "baseline", meanMs: 100, resolutionMs: 16 }),
			right: arm({ label: "boosted", meanMs: 104.7, resolutionMs: 16 }),
		});

		expect(row.verdict).toBe("below instrument resolution");
	});

	it("refuses to attribute a gap the run-to-run spread already covers", () => {
		const [row] = compareArms({
			left: arm({ label: "baseline", meanMs: 100, sdMs: 60, resolutionMs: 1 }),
			right: arm({ label: "boosted", meanMs: 120, sdMs: 60, resolutionMs: 1 }),
		});

		expect(row).toMatchObject({ deltaMs: 20, verdict: "within run-to-run noise" });
	});

	it("names the right arm slower when the gap clears both floors", () => {
		const [row] = compareArms({
			left: arm({ label: "baseline", meanMs: 100, sdMs: 5, resolutionMs: 16 }),
			right: arm({ label: "boosted", meanMs: 300, sdMs: 5, resolutionMs: 16 }),
		});

		expect(row).toMatchObject({ leftMeanMs: 100, rightMeanMs: 300, verdict: "right slower" });
	});

	it("names the right arm faster when it wins by more than both floors", () => {
		const [row] = compareArms({
			left: arm({ label: "baseline", meanMs: 300, sdMs: 5, resolutionMs: 16 }),
			right: arm({ label: "boosted", meanMs: 100, sdMs: 5, resolutionMs: 16 }),
		});

		expect(row).toMatchObject({ deltaMs: -200, verdict: "right faster" });
	});

	it("takes the coarser of the two arms as the resolution the pair is read at", () => {
		const [row] = compareArms({
			left: arm({ label: "baseline", meanMs: 100, resolutionMs: 8 }),
			right: arm({ label: "boosted", meanMs: 400, resolutionMs: 40 }),
		});

		expect(row.resolutionMs).toBe(40);
	});

	it("refuses two arms that measured a different number of conditions", () => {
		const left = arm({ label: "baseline", meanMs: 100 });
		expect(() =>
			compareArms({
				left: { label: left.label, results: [...left.results, ...left.results] },
				right: arm({ label: "boosted", meanMs: 100 }),
			}),
		).toThrow("both arms must have measured the same number of conditions");
	});

	it("refuses two arms whose conditions do not line up", () => {
		expect(() =>
			compareArms({
				left: arm({ label: "baseline", condition: "slow-mobile-small", meanMs: 100 }),
				right: arm({ label: "boosted", condition: "slow-mobile-large", meanMs: 100 }),
			}),
		).toThrow("both arms must have measured the same conditions in the same order");
	});
});

describe("formatComparisonTable", () => {
	it("names both arms in the header and carries every floor beside the gap", () => {
		expect(
			formatComparisonTable({
				left: "baseline",
				right: "boosted",
				rows: [
					{
						condition: "slow-mobile-large",
						leftMeanMs: 315.55,
						rightMeanMs: 498.2,
						deltaMs: 182.65,
						resolutionMs: 16.72,
						noiseMs: 12.34,
						verdict: "right slower",
					},
				],
			}),
		).toBe(
			[
				"| Condition | baseline mean (ms) | boosted mean (ms) | delta (ms) | resolution (ms) | noise (ms) | verdict |",
				"| --- | ---: | ---: | ---: | ---: | ---: | --- |",
				"| slow-mobile-large | 315.6 | 498.2 | 182.7 | 16.7 | 12.3 | right slower |",
			].join("\n"),
		);
	});

	it("refuses to render a comparison of two runs that share no condition", () => {
		expect(() =>
			formatComparisonTable({ left: "baseline", right: "boosted", rows: [] }),
		).toThrow("a comparison table needs at least one condition");
	});
});
