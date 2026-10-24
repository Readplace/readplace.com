import assert from "node:assert/strict";
import { buildSmallMultiples } from "./admin-dashboard-chart.viewmodel";

const WEEK = {
	startTime: new Date("2026-10-11T00:00:00.000Z"),
	endTime: new Date("2026-10-18T00:00:00.000Z"),
};

describe("buildSmallMultiples", () => {
	it("splits rows into one series per group-by key and value column, on one y-scale over the requested window", () => {
		const chart = buildSmallMultiples({
			...WEEK,
			query: "filter event = \"oauth_token_revoked\" | stats count(*) as revocations by bin(1d), client_id, outcome",
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
			query: "filter cohort = \"all\" | stats max(treatment.activated) as treatment_activated by bin(6h)",
			rows: [[{ field: "bin(6h)", value: "2026-10-11 00:00:00.000" }, { field: "treatment_activated", value: "0" }]],
		});

		assert.deepEqual(chart.multiples.map((multiple) => multiple.title), ["treatment_activated"]);
		assert.deepEqual(chart.frame.yLabels.map((label) => label.label), ["0", "0.5", "1"]);
	});

	it("starts the x-axis at the earliest bin when Logs Insights floors it before the requested window", () => {
		const chart = buildSmallMultiples({
			startTime: new Date("2026-10-11T14:00:00.000Z"),
			endTime: new Date("2026-10-18T14:00:00.000Z"),
			query: "stats count(*) as calls by bin(1d)",
			rows: [
				[{ field: "bin(1d)", value: "2026-10-11 00:00:00.000" }, { field: "calls", value: "2" }],
				[{ field: "bin(1d)", value: "2026-10-18 00:00:00.000" }, { field: "calls", value: "4" }],
			],
		});

		assert.deepEqual(chart.multiples.flatMap((multiple) => multiple.points.map((point) => point.cx)), [48, 288]);
		assert.deepEqual(chart.frame.xLabels.map((label) => label.label), ["Oct 11, 2026", "Oct 18, 2026"]);
	});

	it("splits series by a group-by key whose values look like numbers", () => {
		const chart = buildSmallMultiples({
			...WEEK,
			query: "filter event = \"mcp_request_refused\" | stats count(*) as refusals by bin(1d), status | sort refusals desc",
			rows: [
				[{ field: "bin(1d)", value: "2026-10-14 00:00:00.000" }, { field: "status", value: "401" }, { field: "refusals", value: "3" }],
				[{ field: "bin(1d)", value: "2026-10-15 00:00:00.000" }, { field: "status", value: "404" }, { field: "refusals", value: "1" }],
			],
		});

		assert.deepEqual(chart.multiples.map((multiple) => multiple.title), ["401 · refusals", "404 · refusals"]);
	});

	it("reads an aliased bin() as the x-axis and ignores a | or by inside a regex, string or call", () => {
		const chart = buildSmallMultiples({
			...WEEK,
			query: "filter path like /\\/mcp|\\/oauth/ | stats count(*) as calls, sum(strcontains(note, \"by \\\" a | b\")) as notes by bin(1d) as day, coalesce(client, \"none\") as client",
			rows: [
				[{ field: "day", value: "2026-10-14 00:00:00.000" }, { field: "client", value: "claude" }, { field: "calls", value: "3" }, { field: "notes", value: "1" }],
			],
		});

		assert.deepEqual(chart.multiples.map((multiple) => multiple.title), ["claude · calls", "claude · notes"]);
	});

	it.each([
		{ query: "filter event = \"mcp_tool_called\"", error: /must aggregate with stats/ },
		{ query: "filter event = \"mcp_tool_called\" | stats count(*) as calls", error: /stats must group by bin\(\) \(got: stats count\(\*\) as calls\)/ },
		{ query: "stats count(*) as calls by outcome", error: /stats must group by bin\(\) \(got: outcome\)/ },
	])("refuses a time-series query that does not group by bin(): $query", ({ query, error }) => {
		assert.throws(
			() => buildSmallMultiples({ ...WEEK, query, rows: [[{ field: "outcome", value: "ok" }, { field: "calls", value: "4" }]] }),
			error,
		);
	});
});
