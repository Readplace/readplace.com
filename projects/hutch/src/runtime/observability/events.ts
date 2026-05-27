import { PARSE_ERROR_STREAM, CRAWL_OUTCOME_STREAM } from "@packages/hutch-infra-components";

/**
 * Single source of truth for log stream names. Every analytics-style log line
 * carries a `stream` field with one of these values; the dashboards filter on
 * it via `filter stream = "<name>"`. The same import is used by emitters
 * (analytics middleware, conversion emitter, subscription handlers) so a
 * rename here surfaces as a TypeScript error at every call site.
 */
export const STREAMS = {
	analytics: "analytics",
	conversions: "conversions",
	parseErrors: PARSE_ERROR_STREAM,
	crawlOutcomes: CRAWL_OUTCOME_STREAM,
	subscriptions: "subscriptions",
} as const;

export const ANALYTICS_EVENTS = {
	pageview: "pageview",
	importUploaded: "import_uploaded",
	importCommitted: "import_committed",
} as const;

export const CONVERSION_EVENTS = {
	userCreated: "user_created",
} as const;

export const SUBSCRIPTION_EVENTS = {
	chargeSucceeded: "charge_succeeded",
	chargeFailed: "charge_failed",
	cancelled: "cancelled",
} as const;

export const METRICS = {
	importsCompleted: {
		namespace: "Readplace/Imports",
		name: "ImportsCompleted",
	},
} as const;

export const LOG_GROUPS = {
	hutchHandler: "/aws/lambda/hutch-handler",
	subscriptionStartRequest: "/aws/lambda/subscription-start-request-handler",
	subscriptionChargeSucceeded: "/aws/lambda/subscription-charge-succeeded-handler",
	subscriptionChargeFailed: "/aws/lambda/subscription-charge-failed-handler",
	cancelSubscription: "/aws/lambda/cancel-subscription-handler",
	handleSubscriptionCancelled: "/aws/lambda/handle-subscription-cancelled-handler",
} as const;
