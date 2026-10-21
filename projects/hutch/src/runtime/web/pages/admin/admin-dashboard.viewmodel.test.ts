import assert from "node:assert/strict";
import { buildDashboardTable, formatCell } from "./admin-dashboard.viewmodel";

describe("formatCell", () => {
	it.each([
		{ field: "events", value: "1234567", text: "1,234,567", numeric: true },
		{ field: "p_value", value: "0.041234567", text: "0.0412", numeric: true },
		{ field: "diff_pp", value: "-3.5", text: "-3.5", numeric: true },
		{ field: "user_id", value: "12345678901234567890123456789012", text: "12345678901234567890123456789012", numeric: false },
		{ field: "oauth_client_id", value: "2048", text: "2048", numeric: false },
		{ field: "as_of", value: "2026-10-18 00:00:00.000", text: "2026-10-18 00:00:00.000", numeric: false },
		{ field: "verdict", value: "inconclusive", text: "inconclusive", numeric: false },
	])("renders $field=$value as $text", ({ field, value, text, numeric }) => {
		assert.deepEqual(formatCell({ field, value }), { text, numeric });
	});
});

describe("buildDashboardTable", () => {
	it("takes its columns from every row in first-seen order, because Logs Insights omits a row's empty fields", () => {
		const table = buildDashboardTable([
			[{ field: "client_id", value: "readplace-ios" }, { field: "grants", value: "1200" }],
			[{ field: "client_id", value: "ZQDfp02ea4PGzTvwCR" }, { field: "grant_type", value: "refresh_token" }, { field: "grants", value: "3" }],
		]);

		assert.deepEqual(table, {
			columns: ["client_id", "grants", "grant_type"],
			rows: [
				{
					cells: [
						{ label: "client_id", text: "readplace-ios", numeric: false },
						{ label: "grants", text: "1,200", numeric: true },
						{ label: "grant_type", text: "—", numeric: false },
					],
				},
				{
					cells: [
						{ label: "client_id", text: "ZQDfp02ea4PGzTvwCR", numeric: false },
						{ label: "grants", text: "3", numeric: true },
						{ label: "grant_type", text: "refresh_token", numeric: false },
					],
				},
			],
		});
	});
});
