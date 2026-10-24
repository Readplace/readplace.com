import { logWidget } from "../observability/analytics-dashboard";
import type { LogWidgetSpec } from "../observability/log-widget-spec.types";

export const AUTH_DIAGNOSTICS_LOG_GROUP = "/readplace/auth-diagnostics";

export function authDiagnosticsWidgets(input: { logGroupName: string }) {
	const logGroupNames = [input.logGroupName];
	const stream = `filter stream = "auth-diagnostics"`;
	return {
		authenticationFailures: {
			title: "Authentication failures by client and version",
			logGroupNames,
			query: `${stream} | filter outcome = "failure" or event = "credentials_cleared" | stats count_distinct(event_id) by client, client_version, event, reason`,
			x: 0, y: 0, width: 12, height: 7,
			view: "table",
		},
		interruptedRefreshCheckpoints: {
			title: "Interrupted refresh checkpoints",
			logGroupNames,
			query: `${stream} | filter ispresent(operation_id) | stats latest(event) as last_event, latest(recorded_at) as last_seen, latest(client_version) as last_client_version by client, grant_id, operation_id | sort last_seen desc`,
			x: 12, y: 0, width: 12, height: 7,
			view: "table",
		},
		repeatedTransportRequests: {
			title: "Repeated transport requests",
			logGroupNames,
			query: `${stream} | filter source = "server" and event = "oauth_exchange_finished" and ispresent(attempt_id) | stats count_distinct(request_id) as arrivals by client, operation_id, attempt_id | filter arrivals > 1`,
			x: 0, y: 7, width: 12, height: 7,
			view: "table",
		},
		sessionDeletionAndBridgeFailures: {
			title: "Session deletion and bridge failures",
			logGroupNames,
			query: `${stream} | filter event = "session_deleted" or (event = "session_bridge_completed" and outcome = "failure") | fields recorded_at, client, subject_ref, session_ref, grant_id, reason, http_status | sort recorded_at desc | dedup event_id`,
			x: 12, y: 7, width: 12, height: 7,
			view: "table",
		},
		journalAndStorageHealth: {
			title: "Journal and storage health",
			logGroupNames,
			query: `${stream} | filter event = "journal_health" or event = "storage_failed" | stats count_distinct(event_id) as events, max(dropped_events) as maximum_dropped by client, client_version, reason`,
			x: 0, y: 14, width: 12, height: 7,
			view: "table",
		},
	} satisfies Record<string, LogWidgetSpec>;
}

export function buildAuthDiagnosticsDashboard(input: { region: string; logGroupName: string }): string {
	return JSON.stringify({
		widgets: Object.values(authDiagnosticsWidgets(input)).map((spec) =>
			logWidget({ region: input.region, ...spec }),
		),
	});
}
