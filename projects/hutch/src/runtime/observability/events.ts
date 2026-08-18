import type { CheckoutVariant } from "@packages/provider-contracts/hosted-checkout";
import { STREAMS } from "@packages/web-analytics";

export {
	STREAMS,
	ANALYTICS_EVENTS,
	SAVE_SURFACES,
	SAVE_OUTCOMES,
	SIGNUP_OUTCOMES,
	MCP_TOOL_OUTCOMES,
	type SaveSurface,
	type SaveOutcome,
	type SignupOutcome,
	type McpToolOutcome,
} from "@packages/web-analytics";

export const CONVERSION_EVENTS = {
	userCreated: "user_created",
} as const;

export const SUBSCRIPTION_EVENTS = {
	chargeSucceeded: "charge_succeeded",
	chargeFailed: "charge_failed",
	cancelled: "cancelled",
	checkoutStarted: "checkout_started",
	checkoutCompleted: "checkout_completed",
	checkoutReturnFailed: "checkout_return_failed",
	resubscribeCompleted: "resubscribe_completed",
} as const;

// The variant union lives in provider-contracts because it is persisted on the
// pending signup; `satisfies` keeps this lookup table from drifting off it.
export const CHECKOUT_VARIANTS = {
	trialCheckout: "trial_checkout",
	cancelledResubscribe: "cancelled_resubscribe",
	cardDeclineFallback: "card_decline_fallback",
} as const satisfies Record<string, CheckoutVariant>;

export type { CheckoutVariant };

export const CHECKOUT_RETURN_FAILURE_REASONS = {
	invalidQuery: "invalid_query",
	sessionNotFound: "session_not_found",
	notPaid: "not_paid",
	replayed: "replayed",
} as const;

export type CheckoutReturnFailureReason =
	(typeof CHECKOUT_RETURN_FAILURE_REASONS)[keyof typeof CHECKOUT_RETURN_FAILURE_REASONS];

export const METRICS = {
	importsCompleted: {
		namespace: "Readplace/Imports",
		name: "ImportsCompleted",
	},
} as const;

/**
 * Destination log group for the never-expire analytics feed. The forward-analytics
 * Lambda copies the JSON payload of every FORWARDED_STREAMS line from each source
 * group into here (preamble stripped so Logs Insights can query the fields), so
 * business/analytics history is retained forever while each source Lambda's own
 * group keeps its 30-day operational retention. A fixed string is safe because
 * staging and prod are separate AWS accounts, so the name never collides across
 * environments.
 */
export const ANALYTICS_LOG_GROUP = "/readplace/analytics";

/**
 * Destination log group for the error feed. Every source group funnels its error
 * output into here so the dashboard's error widget reads ONE group rather than
 * naming each source: Logs Insights caps a query at 50 log groups (verified
 * against prod — 51 returns "Too many log groups specified") and the account
 * already holds 71 Lambda groups, so an enumerating widget cannot cover the
 * fleet and silently omitted whichever groups nobody remembered to add.
 *
 * 90-day retention rather than the analytics group's never-expire: analytics is
 * business history, errors are operational and disposable.
 */
export const ERRORS_LOG_GROUP = "/readplace/errors";

/** Retention for ERRORS_LOG_GROUP. */
export const ERRORS_LOG_GROUP_RETENTION_DAYS = 90;

/**
 * The log streams the forwarder copies into ANALYTICS_LOG_GROUP — the
 * business/analytics streams the user wants queryable forever. Operational
 * streams (`parse-errors`, `crawl-outcomes`) are deliberately excluded: they stay
 * in their source group under the 30-day retention. The subscription-filter
 * pattern and the backfill script both derive their `$.stream = "…"` clauses from
 * this one list, so it is the single source of truth for what "analytics" means.
 */
export const FORWARDED_STREAMS = [
	STREAMS.analytics,
	STREAMS.conversions,
	STREAMS.subscriptions,
] as const;

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
	subscriptionEvents: "subscription-events",
	sendTrialFeedbackEmail: "send-trial-feedback-email",
} as const;

type LogGroupName<T extends string> = `/aws/lambda/${T}-handler`;

export const LOG_GROUPS = {
	hutchHandler: `/aws/lambda/${LAMBDA_NAMES.hutchHandler}-handler`,
	subscriptionEvents: `/aws/lambda/${LAMBDA_NAMES.subscriptionEvents}-handler`,
	sendTrialFeedbackEmail: `/aws/lambda/${LAMBDA_NAMES.sendTrialFeedbackEmail}-handler`,
} as const satisfies {
	readonly [K in keyof typeof LAMBDA_NAMES]: LogGroupName<(typeof LAMBDA_NAMES)[K]>;
};
