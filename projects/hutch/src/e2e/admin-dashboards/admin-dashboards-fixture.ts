import type { LogsInsightsRow } from "@packages/provider-contracts/logs-insights";
import { ANALYTICS_LOG_GROUP } from "../../runtime/observability/events";
import { AUTH_DIAGNOSTICS_LOG_GROUP } from "../../runtime/auth-diagnostics/dashboard";
import { buildAdminDashboards } from "../../runtime/observability/admin-dashboards";

export const E2E_DASHBOARDS_NOW = new Date("2026-10-18T06:00:00.000Z");

const NO_EXCLUSIONS = { excludedVisitorIds: [], excludedUserIds: [] };

function row(cells: Record<string, string>): LogsInsightsRow {
	return Object.entries(cells).map(([field, value]) => ({ field, value }));
}

function daily(input: { day: number; cells: Record<string, string> }): LogsInsightsRow {
	return row({ "bin(1d)": `2026-10-${String(input.day).padStart(2, "0")} 00:00:00.000`, ...input.cells });
}

export function e2eDashboardAnswers(): { queryString: string; rows: readonly LogsInsightsRow[] }[] {
	const dashboards = buildAdminDashboards({
		analyticsLogGroupName: ANALYTICS_LOG_GROUP,
		authDiagnosticsLogGroupName: AUTH_DIAGNOSTICS_LOG_GROUP,
	});
	const [latestReport, latestReportByCohort, activatedOverTime, deliveryOutcomes] =
		dashboards["hn-experiment"].widgets(NO_EXCLUSIONS);
	const [toolCalls, toolCallsPerDay, , , handshakes] = dashboards.mcp.widgets(NO_EXCLUSIONS);
	const [tokenGrants, revocationsPerDay, authenticationFailures] = dashboards.login.widgets(NO_EXCLUSIONS);

	return [
		{
			queryString: latestReport.query,
			rows: [
				row({
					campaign_id: "hn-starter-2026-09",
					as_of: "2026-10-18 00:00:00.000",
					verdict: "inconclusive",
					review_due: "2026-11-01",
					diff_pp: "4.21875",
					ci_low: "-1.5",
					ci_high: "9.9375",
					p_value: "0.1412",
					t_activated: "61",
					t_assigned: "1204",
					c_activated: "48",
					c_assigned: "1187",
				}),
			],
		},
		{
			queryString: latestReportByCohort.query,
			rows: [
				row({ campaign_id: "hn-starter-2026-09", cohort: "free", as_of: "2026-10-18 00:00:00.000", t_activated: "40", t_assigned: "902", c_activated: "33", c_assigned: "880" }),
				row({ campaign_id: "hn-starter-2026-09", cohort: "trial", as_of: "2026-10-18 00:00:00.000", t_activated: "21", t_assigned: "302", c_activated: "15", c_assigned: "307" }),
			],
		},
		{
			queryString: activatedOverTime.query,
			rows: [11, 12, 13, 14, 15, 16, 17].flatMap((day, index) => [
				row({ "bin(6h)": `2026-10-${day} 00:00:00.000`, treatment_activated: String(30 + index * 4), treatment_mature: String(10 + index * 2), comparison_activated: String(25 + index * 3), comparison_mature: String(8 + index) }),
				row({ "bin(6h)": `2026-10-${day} 12:00:00.000`, treatment_activated: String(32 + index * 4), treatment_mature: String(11 + index * 2), comparison_activated: String(26 + index * 3), comparison_mature: String(9 + index) }),
			]),
		},
		{
			queryString: deliveryOutcomes.query,
			rows: [
				row({ campaign_id: "hn-starter-2026-09", event: "starter_assigned", arm: "treatment", events: "1204", accounts: "1204" }),
				row({ campaign_id: "hn-starter-2026-09", event: "starter_assigned", arm: "comparison", events: "1187", accounts: "1187" }),
				row({ campaign_id: "hn-starter-2026-09", event: "starter_suppressed", arm: "treatment", reason: "already_saved", events: "17", accounts: "17" }),
			],
		},
		{
			queryString: toolCalls.query,
			rows: [
				row({ oauth_client_id: "claude-desktop", tool: "save_link", outcome: "ok", calls: "1532", users: "211" }),
				row({ oauth_client_id: "claude-desktop", tool: "list_readlist_articles", outcome: "ok", calls: "804", users: "97" }),
				row({ oauth_client_id: "chatgpt", tool: "save_link", outcome: "error", calls: "12", users: "9" }),
			],
		},
		{
			queryString: toolCallsPerDay.query,
			rows: [12, 13, 14, 15, 16, 17].flatMap((day, index) => [
				daily({ day, cells: { outcome: "ok", calls: String(180 + index * 22) } }),
				daily({ day, cells: { outcome: "error", calls: String(3 + (index % 3)) } }),
			]),
		},
		{
			queryString: handshakes.query,
			rows: [
				row({ event: "mcp_session_initialized", assistant: "claude-ai", version: "0.1.0", protocol: "2025-06-18", calls: "940", clients: "122" }),
				row({ event: "mcp_tools_listed", assistant: "claude-ai", version: "0.1.0", protocol: "2025-06-18", calls: "933", clients: "121" }),
			],
		},
		{
			queryString: tokenGrants.query,
			rows: [
				row({ event: "oauth_token_issued", grant_type: "refresh_token", client_id: "readplace-ios", grants: "18240" }),
				row({ event: "oauth_token_issued", grant_type: "authorization_code", client_id: "readplace-ios", grants: "311" }),
				row({ event: "oauth_token_refused", grant_type: "refresh_token", client_id: "readplace-chrome", grants: "6" }),
			],
		},
		{
			queryString: revocationsPerDay.query,
			rows: [13, 15, 17].map((day, index) =>
				daily({ day, cells: { client_id: "readplace-ios", outcome: "revoked", revocations: String(2 + index) } }),
			),
		},
		{
			queryString: authenticationFailures.query,
			rows: [
				row({ client: "ios", client_version: "94", event: "refresh_failed", reason: "invalid_grant", "count_distinct(event_id)": "14" }),
			],
		},
	];
}
