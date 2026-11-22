import assert from "node:assert/strict";
import { ADMIN_DASHBOARD_SLUGS, ANALYTICS_LOG_GROUP, AUTH_DIAGNOSTICS_LOG_GROUP, buildAdminDashboards } from "@packages/dashboard-widgets";
import { e2eDashboardAnswers } from "./admin-dashboards-fixture";

describe("e2eDashboardAnswers", () => {
	const dashboards = buildAdminDashboards({
		analyticsLogGroupName: ANALYTICS_LOG_GROUP,
		authDiagnosticsLogGroupName: AUTH_DIAGNOSTICS_LOG_GROUP,
	});
	const widgetQueries = new Set(
		ADMIN_DASHBOARD_SLUGS.flatMap((slug) =>
			dashboards[slug].widgets({ excludedVisitorIds: [], excludedUserIds: [] }).map((widget) => widget.query),
		),
	);

	it("answers only queries a dashboard widget runs, each once and with rows", () => {
		const answers = e2eDashboardAnswers();

		for (const answer of answers) {
			assert.ok(widgetQueries.has(answer.queryString), "every fixture answer must match a widget query");
			assert.ok(answer.rows.length > 0, "every fixture answer must carry rows");
		}
		assert.equal(new Set(answers.map((answer) => answer.queryString)).size, answers.length);
	});
});
