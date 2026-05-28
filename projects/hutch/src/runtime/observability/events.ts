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

/**
 * Names passed to `new HutchLambda(...)` for the Lambdas whose log groups
 * the analytics dashboard queries. `HutchLambda` appends `-handler` to this
 * name when it creates the `aws.lambda.Function`, so the matching log group
 * AWS creates on first invocation is `/aws/lambda/<name>-handler`. Each
 * entry here is the *single* place that name is written; `LOG_GROUPS` and
 * the Pulumi explicit `aws.cloudwatch.LogGroup` resources both derive from
 * it, so a rename here propagates atomically to the dashboard's log-group
 * references and to the explicit log-group resource. The analytics-dashboard
 * test then guarantees every entry is wired into a widget.
 */
export const LAMBDA_NAMES = {
	hutchHandler: "hutch",
	subscriptionStartRequest: "subscription-start-request",
	subscriptionChargeSucceeded: "subscription-charge-succeeded",
	subscriptionChargeFailed: "subscription-charge-failed",
	cancelSubscription: "cancel-subscription",
	handleSubscriptionCancelled: "handle-subscription-cancelled",
} as const;

type LogGroupName<T extends string> = `/aws/lambda/${T}-handler`;

export const LOG_GROUPS = {
	hutchHandler: `/aws/lambda/${LAMBDA_NAMES.hutchHandler}-handler`,
	subscriptionStartRequest: `/aws/lambda/${LAMBDA_NAMES.subscriptionStartRequest}-handler`,
	subscriptionChargeSucceeded: `/aws/lambda/${LAMBDA_NAMES.subscriptionChargeSucceeded}-handler`,
	subscriptionChargeFailed: `/aws/lambda/${LAMBDA_NAMES.subscriptionChargeFailed}-handler`,
	cancelSubscription: `/aws/lambda/${LAMBDA_NAMES.cancelSubscription}-handler`,
	handleSubscriptionCancelled: `/aws/lambda/${LAMBDA_NAMES.handleSubscriptionCancelled}-handler`,
} as const satisfies {
	readonly [K in keyof typeof LAMBDA_NAMES]: LogGroupName<(typeof LAMBDA_NAMES)[K]>;
};
