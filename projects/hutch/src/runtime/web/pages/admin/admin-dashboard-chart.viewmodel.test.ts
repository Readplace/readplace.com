import assert from "node:assert/strict";
import { buildSmallMultiples } from "./admin-dashboard-chart.viewmodel";

const WEEK = {
	startTime: new Date("2026-10-11T00:00:00.000Z"),
	endTime: new Date("2026-10-18T00:00:00.000Z"),
};

describe("buildSmallMultiples", () => {
	it("splits rows into one series per non-numeric key and value column, on one y-scale over the requested window", () => {
		const chart = buildSmallMultiples({
			...WEEK,
			rows: [
				[{ field: "bin(1d)", value: "2026-10-17 00:00:00.000" }, { field: "client_id", value: "readplace-ios" }, { field: "outcome", value: "revoked" }, { field: "revocations", value: "7" }],
				[{ field: "bin(1d)", value: "2026-10-14 00:00:00.000" }, { field: "client_id", value: "readplace-ios" }, { field: "outcome", value: "revoked" }, { field: "revocations", value: "3" }],
				[{ field: "bin(1d)", value: "2026-10-15 00:00:00.000" }, { field: "outcome", value: "unknown_token" }],
			],
		});

		assert.deepEqual(chart.frame, {
			viewBox: "0 0 320 140",
			gridLines: [
				{ x1: 48, x2: 308, y: 114 },
				{ x1: 48, x2: 308, y: 62 },
				{ x1: 48, x2: 308, y: 10 },
			],
			yLabels: [
				{ x: 42, y: 114, label: "0" },
				{ x: 42, y: 62, label: "5" },
				{ x: 42, y: 10, label: "10" },
			],
			xLabels: [
				{ x: 48, y: 132, label: "Oct 11, 2026", anchor: "start" },
				{ x: 308, y: 132, label: "Oct 18, 2026", anchor: "end" },
			],
		});
		assert.deepEqual(chart.multiples, [
			{
				title: "readplace-ios · revoked · revocations",
				line: "159.4,82.8 270.9,41.2",
				points: [
					{ cx: 159.4, cy: 82.8, title: "3 at Oct 14, 2026, 00:00 UTC" },
					{ cx: 270.9, cy: 41.2, title: "7 at Oct 17, 2026, 00:00 UTC" },
				],
			},
		]);
	});

	it("names a series by its value column when the rows carry no key, and scales an all-zero series to 1", () => {
		const chart = buildSmallMultiples({
			...WEEK,
			rows: [[{ field: "bin(6h)", value: "2026-10-11 00:00:00.000" }, { field: "treatment_activated", value: "0" }]],
		});

		assert.deepEqual(chart.multiples.map((multiple) => multiple.title), ["treatment_activated"]);
		assert.deepEqual(chart.frame.yLabels.map((label) => label.label), ["0", "0.5", "1"]);
	});

	it("refuses rows without a bin() field, which a time-series widget always groups by", () => {
		assert.throws(
			() => buildSmallMultiples({ ...WEEK, rows: [[{ field: "outcome", value: "ok" }, { field: "calls", value: "4" }]] }),
			/a time-series widget's rows must carry a bin\(\) field \(got: outcome, calls\)/,
		);
	});
});
