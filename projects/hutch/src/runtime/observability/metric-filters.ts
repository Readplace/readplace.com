import { SUPPORTED_CLIENTS } from "@packages/supported-clients";
import { OAUTH_TOKEN_GRANT_TYPES } from "@packages/web-analytics";
import type { ProofValidation } from "../oauth-refresh/dpop";
import type { RevocationCause } from "../oauth-refresh/evidence";
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

const READER_DISCONNECT = "disconnect" satisfies RevocationCause;
const LOGOUT_ALL = "logout-all" satisfies RevocationCause;
const NONCE_REQUIRED = "nonce_required" satisfies Extract<ProofValidation, { ok: false }>["reason"];

export function firstPartyRefreshRefusedExceptDisconnectLogoutAllAndNonceRequiredPattern(): string {
	const anyFirstPartyClient = SUPPORTED_CLIENTS.flatMap((client) =>
		client.auth.kind === "builtIn" ? [`$.client_id = "${client.auth.oauthClientId}"`] : [],
	).join(" || ");
	return `{ $.stream = "${STREAMS.analytics}" && $.event = "${ANALYTICS_EVENTS.oauthTokenRefused}" && $.grant_type = "${OAUTH_TOKEN_GRANT_TYPES.refreshToken}" && (${anyFirstPartyClient}) && $.refresh_refusal.reason != "${READER_DISCONNECT}" && $.refresh_refusal.reason != "${LOGOUT_ALL}" && $.refresh_refusal.reason != "${NONCE_REQUIRED}" }`;
}
