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
	click: "click",
	importUploaded: "import_uploaded",
	importFromUrlAcquired: "import_from_url_acquired",
	importCommitted: "import_committed",
	articleRead: "article_read",
	summaryToggled: "summary_toggled",
	viewOpened: "view_opened",
	viewSaveIntent: "view_save_intent",
} as const;

/**
 * Dimensions of the `view_save_intent` event. Each is the single source of
 * truth shared by emitters (the save surfaces) and the dashboard widgets that
 * slice the save funnel, so a value rename surfaces as a TypeScript error at
 * every call site rather than silently splitting a metric in two.
 */
export const SAVE_SURFACES = {
	readerView: "reader_view",
	queueSaveBar: "queue_save_bar",
	extension: "extension",
} as const;

export const SAVE_OUTCOMES = {
	saved: "saved",
	promptedToSignUp: "prompted_to_sign_up",
	error: "error",
} as const;

export const CONTENT_CLASSES = {
	own: "own",
	thirdParty: "third_party",
} as const;

export type SaveSurface = (typeof SAVE_SURFACES)[keyof typeof SAVE_SURFACES];
export type SaveOutcome = (typeof SAVE_OUTCOMES)[keyof typeof SAVE_OUTCOMES];

/**
 * `utm_medium` value stamped on every in-site link and action button so a click
 * can be counted without an extra request or a client-side beacon. The analytics
 * middleware emits a `click` event for any request carrying it (GET, HTMX-boosted,
 * or POST) and keeps it out of `pageview` so acquisition dashboards — which group
 * by the real `utm_source` (hackernews, newsletter, …) — are not diluted by
 * internal navigation. Imported by both the link-tagging helper (producer) and
 * the analytics middleware (consumer) so the two never drift.
 */
export const INTERNAL_CLICK_MEDIUM = "internal";

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
	scheduleTrialFeedbackEmail: "schedule-trial-feedback-email",
	sendTrialFeedbackEmail: "send-trial-feedback-email",
} as const;

type LogGroupName<T extends string> = `/aws/lambda/${T}-handler`;

export const LOG_GROUPS = {
	hutchHandler: `/aws/lambda/${LAMBDA_NAMES.hutchHandler}-handler`,
	subscriptionStartRequest: `/aws/lambda/${LAMBDA_NAMES.subscriptionStartRequest}-handler`,
	subscriptionChargeSucceeded: `/aws/lambda/${LAMBDA_NAMES.subscriptionChargeSucceeded}-handler`,
	subscriptionChargeFailed: `/aws/lambda/${LAMBDA_NAMES.subscriptionChargeFailed}-handler`,
	cancelSubscription: `/aws/lambda/${LAMBDA_NAMES.cancelSubscription}-handler`,
	handleSubscriptionCancelled: `/aws/lambda/${LAMBDA_NAMES.handleSubscriptionCancelled}-handler`,
	scheduleTrialFeedbackEmail: `/aws/lambda/${LAMBDA_NAMES.scheduleTrialFeedbackEmail}-handler`,
	sendTrialFeedbackEmail: `/aws/lambda/${LAMBDA_NAMES.sendTrialFeedbackEmail}-handler`,
} as const satisfies {
	readonly [K in keyof typeof LAMBDA_NAMES]: LogGroupName<(typeof LAMBDA_NAMES)[K]>;
};
