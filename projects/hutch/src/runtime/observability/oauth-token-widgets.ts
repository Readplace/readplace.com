import { ANALYTICS_EVENTS, STREAMS } from "./events";
import type { LogWidgetSpec } from "./log-widget-spec.types";

export function oauthTokenWidgets(deps: { analyticsLogGroupName: string }) {
	const analyticsSource = [deps.analyticsLogGroupName];

	return {
		tokenGrants: {
			title: "OAuth token grants — issued vs refused by client",
			logGroupNames: analyticsSource,
			query: [
				"fields @timestamp, event, grant_type, client_id",
				`| filter stream = "${STREAMS.analytics}" and (event = "${ANALYTICS_EVENTS.oauthTokenIssued}" or event = "${ANALYTICS_EVENTS.oauthTokenRefused}")`,
				"| stats count(*) as grants by event, grant_type, client_id",
				"| sort grants desc",
				"| limit 40",
			].join(" "),
			x: 0, y: 194, width: 12, height: 8,
			view: "table",
		},
		revocationsPerDay: {
			title: "OAuth token revocations — per day by client × outcome",
			logGroupNames: analyticsSource,
			query: [
				"fields @timestamp, client_id, outcome",
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.oauthTokenRevoked}"`,
				"| stats count(*) as revocations by bin(1d), client_id, outcome",
			].join(" "),
			x: 12, y: 238, width: 12, height: 8,
			view: "timeSeries",
		},
	} satisfies Record<string, LogWidgetSpec>;
}
