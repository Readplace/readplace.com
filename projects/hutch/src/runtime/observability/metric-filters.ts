import { ANALYTICS_EVENTS, CONVERSION_EVENTS, STREAMS } from "./events";

export const ANALYTICS_METRIC_NAMESPACE = "Readplace/Analytics";

export interface AnalyticsMetricFilter {
	readonly stream: string;
	readonly event: string;
	readonly metricName: string;
	readonly widgetTitle: string;
}

export const ANALYTICS_METRIC_FILTERS = {
	pageview: {
		stream: STREAMS.analytics,
		event: ANALYTICS_EVENTS.pageview,
		metricName: "Pageviews",
		widgetTitle: "Pageviews (CloudWatch metric since 2026-08-24, internal traffic included)",
	},
	viewSaveIntent: {
		stream: STREAMS.analytics,
		event: ANALYTICS_EVENTS.viewSaveIntent,
		metricName: "ViewSaveIntent",
		widgetTitle: "Save intents (CloudWatch metric since 2026-08-24, internal traffic included)",
	},
	userCreated: {
		stream: STREAMS.conversions,
		event: CONVERSION_EVENTS.userCreated,
		metricName: "UsersCreated",
		widgetTitle: "Signups (CloudWatch metric since 2026-08-24, internal traffic included)",
	},
} as const satisfies Record<string, AnalyticsMetricFilter>;

export function analyticsMetricFilterPattern(filter: AnalyticsMetricFilter): string {
	return `{ $.stream = "${filter.stream}" && $.event = "${filter.event}" }`;
}
