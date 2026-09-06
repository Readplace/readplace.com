import {
	type AnalyticsEvent,
	buildMcpSaveIntentEvent,
	buildMcpToolCalledEvent,
	MCP_TOOL_OUTCOMES,
	type RecordUngatedEvent,
	SAVE_OUTCOMES,
} from "@packages/web-analytics";
import type { RecordMcpToolCall } from "./mcp-server";
import { SAVE_LINK_TOOL } from "./tool-definitions";

const MCP_SAVE_INTENT_PATH = "/mcp";

export function initRecordMcpToolCall(deps: {
	recordUngatedAnalyticsEvent: RecordUngatedEvent<AnalyticsEvent>;
	now: () => Date;
}): RecordMcpToolCall {
	return (record) => {
		deps.recordUngatedAnalyticsEvent(
			buildMcpToolCalledEvent(
				{ now: deps.now },
				{
					tool: record.tool,
					outcome: record.outcome,
					oauthClientId: record.oauthClientId,
					userId: record.userId,
					...(record.sortOrder === undefined
						? {}
						: { sortOrder: record.sortOrder }),
					...(record.submittedUrl === undefined
						? {}
						: { submittedUrl: record.submittedUrl }),
				},
			),
		);

		if (record.tool !== SAVE_LINK_TOOL.name) return;
		if (record.submittedUrl === undefined) return;

		deps.recordUngatedAnalyticsEvent(
			buildMcpSaveIntentEvent(
				{ now: deps.now },
				{
					url: record.submittedUrl,
					path: MCP_SAVE_INTENT_PATH,
					outcome:
						record.outcome === MCP_TOOL_OUTCOMES.ok
							? SAVE_OUTCOMES.saved
							: SAVE_OUTCOMES.error,
				},
			),
		);
	};
}
