import { mcpOperationMetadata } from "@packages/domain/mcp";
import { ANALYTICS_EVENTS, MCP_TOOL_OUTCOMES, STREAMS } from "@packages/web-analytics";
import { type ExcludedIdentities, excludeNonAudienceClauses } from "./excluded-identities";
import { ANALYTICS_LOG_GROUP } from "./log-groups";
import type { LogWidgetSpec } from "./log-widget-spec.types";

export function mcpWidgets(deps: { identities: ExcludedIdentities }) {
	const analyticsSource = [ANALYTICS_LOG_GROUP];
	const exclude = excludeNonAudienceClauses(deps.identities);

	return {
		toolCalls: {
			title: "MCP tool calls by client × tool × outcome",
			logGroupNames: analyticsSource,
			query: [
				"fields @timestamp, oauth_client_id, tool, outcome",
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.mcpToolCalled}"`,
				...exclude,
				"| stats count(*) as calls, count_distinct(user_id) as users by oauth_client_id, tool, outcome",
				"| sort calls desc",
				"| limit 50",
			].join(" "),
			view: "table",
		},
		toolCallsPerDay: {
			title: "MCP tool calls per day by outcome",
			logGroupNames: analyticsSource,
			query: [
				"fields @timestamp, outcome",
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.mcpToolCalled}"`,
				...exclude,
				"| stats count(*) as calls by bin(1d), outcome",
			].join(" "),
			view: "timeSeries",
		},
		calledButNeverSaved: {
			title: "MCP users who called a tool but never saved",
			logGroupNames: analyticsSource,
			query: [
				"fields user_id, tool",
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.mcpToolCalled}"`,
				...exclude,
				`| stats count(*) as calls, sum(tool = "${mcpOperationMetadata("save_link").name}" and outcome = "${MCP_TOOL_OUTCOMES.ok}") as saves by user_id`,
				"| sort calls desc",
				"| limit 50",
			].join(" "),
			view: "table",
		},
		transportRefusalsPerDay: {
			title: "MCP requests refused by the transport — per day by reason × client",
			logGroupNames: analyticsSource,
			query: [
				"fields @timestamp, reason, ua_client",
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.mcpRequestRefused}"`,
				"| stats count(*) as refusals by bin(1d), reason, ua_client",
			].join(" "),
			view: "timeSeries",
		},
		handshakes: {
			title: "MCP handshakes — initialize and tools/list by declared client",
			logGroupNames: analyticsSource,
			query: [
				'fields @timestamp, event, coalesce(client_name, "-") as assistant, coalesce(client_version, "-") as version, coalesce(client_protocol_version, "-") as protocol',
				`| filter stream = "${STREAMS.analytics}" and event in ["${ANALYTICS_EVENTS.mcpSessionInitialized}", "${ANALYTICS_EVENTS.mcpToolsListed}"]`,
				"| stats count(*) as calls, count_distinct(oauth_client_id) as clients by event, assistant, version, protocol",
				"| sort calls desc",
				"| limit 50",
			].join(" "),
			view: "table",
		},
	} satisfies Record<string, LogWidgetSpec>;
}
