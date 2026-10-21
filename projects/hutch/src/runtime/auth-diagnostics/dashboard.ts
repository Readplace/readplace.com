export const AUTH_DIAGNOSTICS_LOG_GROUP = "/readplace/auth-diagnostics";

export function buildAuthDiagnosticsDashboard(input: { region: string; logGroupName: string }): string {
	const source = `SOURCE '${input.logGroupName}' | filter stream = "auth-diagnostics"`;
	const queries = [
		["Authentication failures by client and version", `${source} | filter outcome = "failure" or event = "credentials_cleared" | stats count_distinct(event_id) by client, client_version, event, reason`],
		["Interrupted refresh checkpoints", `${source} | filter ispresent(operation_id) | stats latest(event) as last_event, latest(recorded_at) as last_seen, latest(client_version) as last_client_version by client, grant_id, operation_id | sort last_seen desc`],
		["Repeated transport requests", `${source} | filter source = "server" and event = "oauth_exchange_finished" and ispresent(attempt_id) | stats count_distinct(request_id) as arrivals by client, operation_id, attempt_id | filter arrivals > 1`],
		["Session deletion and bridge failures", `${source} | filter event = "session_deleted" or (event = "session_bridge_completed" and outcome = "failure") | fields recorded_at, client, subject_ref, session_ref, grant_id, reason, http_status | sort recorded_at desc | dedup event_id`],
		["Journal and storage health", `${source} | filter event = "journal_health" or event = "storage_failed" | stats count_distinct(event_id) as events, max(dropped_events) as maximum_dropped by client, client_version, reason`],
	] as const;
	return JSON.stringify({ widgets: queries.map(([title, query], index) => ({
		type: "log", x: (index % 2) * 12, y: Math.floor(index / 2) * 7, width: 12, height: 7,
		properties: { region: input.region, title, query, view: "table" },
	})) });
}
