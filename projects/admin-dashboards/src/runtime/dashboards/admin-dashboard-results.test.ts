import assert from "node:assert/strict";
import { buildAdminDashboards } from "@packages/dashboard-widgets";
import { type DashboardWidgetResult, initAdminDashboardResults } from "./admin-dashboard-results";

const [spec] = buildAdminDashboards({
	analyticsLogGroupName: "/readplace/analytics",
	authDiagnosticsLogGroupName: "/readplace/auth-diagnostics",
}).mcp.widgets({ excludedVisitorIds: [], excludedUserIds: [] });

function resultsWith(value: string): readonly DashboardWidgetResult[] {
	return [{ spec, rows: [[{ field: "calls", value }]] }];
}

const END = "2026-10-18T06:00:00.000Z";
const LATER_END = "2026-10-18T06:10:00.000Z";

describe("initAdminDashboardResults", () => {
	it("finds nothing before anything is kept", () => {
		const { findDashboardResults } = initAdminDashboardResults();

		assert.equal(findDashboardResults({ slug: "mcp", range: "7d", endTime: new Date(END) }), undefined);
	});

	it("finds kept results for the same view at the same instant", () => {
		const { findDashboardResults, keepDashboardResults } = initAdminDashboardResults();
		const results = resultsWith("12");

		keepDashboardResults({ view: { slug: "mcp", range: "7d", endTime: new Date(END) }, results });

		assert.equal(findDashboardResults({ slug: "mcp", range: "7d", endTime: new Date(END) }), results);
	});

	it("finds nothing for the same view at a later end", () => {
		const { findDashboardResults, keepDashboardResults } = initAdminDashboardResults();

		keepDashboardResults({ view: { slug: "mcp", range: "7d", endTime: new Date(END) }, results: resultsWith("12") });

		assert.equal(findDashboardResults({ slug: "mcp", range: "7d", endTime: new Date(LATER_END) }), undefined);
	});

	it("keeps ranges and dashboards with the same end side by side", () => {
		const { findDashboardResults, keepDashboardResults } = initAdminDashboardResults();
		const weekOfMcp = resultsWith("1");
		const dayOfMcp = resultsWith("2");
		const weekOfLogin = resultsWith("3");

		keepDashboardResults({ view: { slug: "mcp", range: "7d", endTime: new Date(END) }, results: weekOfMcp });
		keepDashboardResults({ view: { slug: "mcp", range: "1d", endTime: new Date(END) }, results: dayOfMcp });
		keepDashboardResults({ view: { slug: "login", range: "7d", endTime: new Date(END) }, results: weekOfLogin });

		assert.deepEqual(
			[
				findDashboardResults({ slug: "mcp", range: "7d", endTime: new Date(END) }),
				findDashboardResults({ slug: "mcp", range: "1d", endTime: new Date(END) }),
				findDashboardResults({ slug: "login", range: "7d", endTime: new Date(END) }),
			],
			[weekOfMcp, dayOfMcp, weekOfLogin],
		);
	});

	it("drops every earlier view once results for a later end are kept", () => {
		const { findDashboardResults, keepDashboardResults } = initAdminDashboardResults();
		const later = resultsWith("9");

		keepDashboardResults({ view: { slug: "mcp", range: "7d", endTime: new Date(END) }, results: resultsWith("12") });
		keepDashboardResults({ view: { slug: "login", range: "1d", endTime: new Date(LATER_END) }, results: later });

		assert.equal(findDashboardResults({ slug: "mcp", range: "7d", endTime: new Date(END) }), undefined);
		assert.equal(findDashboardResults({ slug: "login", range: "1d", endTime: new Date(LATER_END) }), later);
	});
});
