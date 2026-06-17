import assert from "node:assert";
import {
	ANALYTICS_EVENTS,
	CONVERSION_EVENTS,
	LOG_GROUPS,
	METRICS,
	SAVE_OUTCOMES,
	SAVE_SURFACES,
	STREAMS,
	SUBSCRIPTION_EVENTS,
} from "./events";

export interface DashboardWidget {
	type: string;
	x: number;
	y: number;
	width: number;
	height: number;
	properties: Record<string, unknown>;
}

export interface DashboardBody {
	widgets: DashboardWidget[];
}

export interface BuildAnalyticsDashboardDeps {
	region: string;
	hutchLogGroupName: string;
	subscriptionLogGroupNames: readonly string[];
	excludedVisitorHashes: readonly string[];
}

/**
 * Dashboard log widgets prepend each log group with its own `SOURCE` keyword
 * and join them with `|`. The `logGroups(namePrefix: [...])` function exists
 * only for the start-query CLI/API and the dashboard renderer rejects it with
 * `Invalid NamePrefix: "namePrefix: ["`.
 * See https://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/CloudWatch-Dashboard-Body-Structure.html#CloudWatch-Dashboard-Properties-Log-Widget-Object
 */
function sourceClause(logGroupNames: readonly string[]): string {
	assert(logGroupNames.length > 0, "sourceClause requires at least one log group name");
	return logGroupNames.map((n) => `SOURCE '${n}'`).join(" | ");
}

function excludeVisitorHashesClause(excludedVisitorHashes: readonly string[]): string[] {
	if (excludedVisitorHashes.length === 0) return [];
	const list = excludedVisitorHashes.map((h) => `"${h}"`).join(", ");
	return [`| filter (not ispresent(visitor_hash)) or (visitor_hash not in [${list}])`];
}

function logWidget(params: {
	region: string;
	title: string;
	logGroupNames: readonly string[];
	query: string;
	x: number;
	y: number;
	width: number;
	height: number;
	view: "pie" | "table" | "bar" | "timeSeries";
}): DashboardWidget {
	return {
		type: "log",
		x: params.x,
		y: params.y,
		width: params.width,
		height: params.height,
		properties: {
			region: params.region,
			title: params.title,
			query: `${sourceClause(params.logGroupNames)} | ${params.query}`,
			view: params.view,
		},
	};
}

export function buildAnalyticsDashboardBody(deps: BuildAnalyticsDashboardDeps): DashboardBody {
	const { region, hutchLogGroupName, subscriptionLogGroupNames, excludedVisitorHashes } = deps;
	const exclude = excludeVisitorHashesClause(excludedVisitorHashes);
	const widgets: DashboardWidget[] = [];

	// --- Traffic + Audience ---

	widgets.push(
		logWidget({
			region,
			title: "Pageviews by utm_source (%)",
			logGroupNames: [hutchLogGroupName],
			query: [
				"fields @timestamp, utm_source",
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.pageview}"`,
				...exclude,
				"| filter ispresent(utm_source) and utm_source != \"\"",
				"| stats count(*) as visits by utm_source",
				"| sort visits desc",
				"| limit 10",
			].join(" "),
			x: 0, y: 0, width: 12, height: 8,
			view: "pie",
		}),
		logWidget({
			region,
			title: "Top Referrers",
			logGroupNames: [hutchLogGroupName],
			query: [
				"fields @timestamp, referrer_host",
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.pageview}"`,
				...exclude,
				"| filter ispresent(referrer_host) and referrer_host != \"\"",
				"| stats count(*) as visits by referrer_host",
				"| sort visits desc",
				"| limit 10",
			].join(" "),
			x: 12, y: 0, width: 12, height: 8,
			view: "pie",
		}),
		logWidget({
			region,
			title: "Pageviews by Source / Medium / Content (%)",
			logGroupNames: [hutchLogGroupName],
			query: [
				"fields @timestamp, utm_source, utm_medium, utm_content, concat(utm_source, \" / \", coalesce(utm_medium, \"-\"), \" / \", coalesce(utm_content, \"-\")) as utm_path",
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.pageview}"`,
				...exclude,
				"| filter ispresent(utm_source) and utm_source != \"\"",
				"| stats count(*) as visits by utm_path",
				"| sort visits desc",
				"| limit 10",
			].join(" "),
			x: 0, y: 8, width: 12, height: 8,
			view: "pie",
		}),
		logWidget({
			region,
			title: "Distinct Visitors per Day",
			logGroupNames: [hutchLogGroupName],
			query: [
				"fields @timestamp, visitor_hash",
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.pageview}"`,
				"| filter ispresent(visitor_hash)",
				...exclude,
				"| stats count_distinct(visitor_hash) as visitors by bin(1d)",
			].join(" "),
			x: 12, y: 8, width: 12, height: 8,
			view: "timeSeries",
		}),
		logWidget({
			region,
			title: "Distinct Authenticated Readers per Day",
			logGroupNames: [hutchLogGroupName],
			query: [
				"fields @timestamp, user_id, visitor_hash",
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.articleRead}"`,
				...exclude,
				"| stats count_distinct(user_id) as authenticated_unique_readers by bin(1d)",
			].join(" "),
			x: 0, y: 16, width: 12, height: 8,
			view: "timeSeries",
		}),
		logWidget({
			region,
			title: "Reader Opens per Day",
			logGroupNames: [hutchLogGroupName],
			query: [
				"fields @timestamp, visitor_hash, path, is_authenticated",
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.pageview}"`,
				"| filter ispresent(visitor_hash)",
				...exclude,
				"| filter is_authenticated",
				"| filter path like /^\\/[^\\/]+\\/view$/",
				"| stats count_distinct(visitor_hash) as reader_opens by bin(1d)",
			].join(" "),
			x: 12, y: 16, width: 12, height: 8,
			view: "timeSeries",
		}),
		logWidget({
			region,
			title: "Pageviews — UTM detail (all params)",
			logGroupNames: [hutchLogGroupName],
			query: [
				"fields coalesce(utm_source, \"(none)\") as source, coalesce(utm_medium, \"(none)\") as medium, coalesce(utm_campaign, \"(none)\") as campaign, coalesce(utm_content, \"(none)\") as content",
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.pageview}"`,
				...exclude,
				"| filter ispresent(utm_source) or ispresent(utm_medium) or ispresent(utm_campaign) or ispresent(utm_content)",
				"| stats count(*) as visits by source, medium, campaign, content",
				"| sort visits desc",
				"| limit 50",
			].join(" "),
			x: 0, y: 24, width: 24, height: 8,
			view: "table",
		}),
	);

	// --- Conversions ---
	// No exclude clause because conversion events carry no visitor_hash.

	widgets.push(
		logWidget({
			region,
			title: "Conversions by Source (unique users)",
			logGroupNames: [hutchLogGroupName],
			query: [
				"fields @timestamp, user_id, coalesce(utm_source, referrer_host, \"direct\") as source",
				`| filter stream = "${STREAMS.conversions}" and event = "${CONVERSION_EVENTS.userCreated}"`,
				"| stats count_distinct(user_id) as unique_users by source",
				"| sort unique_users desc",
				"| limit 20",
			].join(" "),
			x: 0, y: 32, width: 12, height: 8,
			view: "pie",
		}),
		logWidget({
			region,
			title: "Conversions by Source × Tier",
			logGroupNames: [hutchLogGroupName],
			query: [
				"fields @timestamp, user_id, coalesce(utm_source, referrer_host, \"direct\") as source, tier",
				`| filter stream = "${STREAMS.conversions}" and event = "${CONVERSION_EVENTS.userCreated}"`,
				"| stats count_distinct(user_id) as unique_users by source, tier",
				"| sort unique_users desc",
				"| limit 30",
			].join(" "),
			x: 12, y: 32, width: 12, height: 8,
			view: "table",
		}),
		logWidget({
			region,
			title: "Recent Conversions",
			logGroupNames: [hutchLogGroupName],
			query: [
				"fields @timestamp, user_id, method, tier, utm_source, utm_medium, utm_campaign, utm_content, referrer_host, landing_path, first_seen_at",
				`| filter stream = "${STREAMS.conversions}" and event = "${CONVERSION_EVENTS.userCreated}"`,
				"| sort @timestamp desc",
				"| limit 50",
			].join(" "),
			x: 0, y: 40, width: 24, height: 8,
			view: "table",
		}),
	);

	// --- Imports + Medium ---

	widgets.push({
		type: "metric",
		x: 0, y: 48, width: 6, height: 4,
		properties: {
			region,
			title: "Imports completed (lifetime)",
			metrics: [[METRICS.importsCompleted.namespace, METRICS.importsCompleted.name, { stat: "Sum" }]],
			period: 86400,
			stat: "Sum",
			view: "singleValue",
			sparkline: true,
			setPeriodToTimeRange: true,
		},
	});

	widgets.push(
		/**
		 * Counts inbound pageviews where the Medium `source=post_page-----<id>`
		 * parameter is present, grouped by post id. The middleware extracts
		 * the id into `medium_post_id`. To resolve an id back to a post, open
		 * https://medium.com/p/<id>.
		 */
		logWidget({
			region,
			title: "Top Medium Posts by Clicks",
			logGroupNames: [hutchLogGroupName],
			query: [
				"fields @timestamp, medium_post_id",
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.pageview}"`,
				"| filter ispresent(medium_post_id) and medium_post_id != \"\"",
				...exclude,
				"| stats count(*) as clicks by medium_post_id",
				"| sort clicks desc",
				"| limit 10",
			].join(" "),
			x: 6, y: 48, width: 12, height: 4,
			view: "pie",
		}),
		/** Stacked counts of acquire events vs import_committed surface
		 *  silent acquire→commit failures (acquired but never committed). */
		logWidget({
			region,
			title: "Import acquire → commit funnel per day",
			logGroupNames: [hutchLogGroupName],
			query: [
				"fields @timestamp, event",
				`| filter stream = "${STREAMS.analytics}"`,
				`| filter event in ["${ANALYTICS_EVENTS.importUploaded}", "${ANALYTICS_EVENTS.importFromUrlAcquired}", "${ANALYTICS_EVENTS.importCommitted}"]`,
				"| stats count(*) as imports by bin(1d), event",
			].join(" "),
			x: 0, y: 52, width: 24, height: 6,
			view: "timeSeries",
		}),
	);

	// --- Subscriptions ---

	widgets.push(
		logWidget({
			region,
			title: "Trial-end charge outcomes per day",
			logGroupNames: subscriptionLogGroupNames,
			query: [
				"fields @timestamp, event",
				`| filter stream = "${STREAMS.subscriptions}"`,
				`| filter event in ["${SUBSCRIPTION_EVENTS.chargeSucceeded}", "${SUBSCRIPTION_EVENTS.chargeFailed}"]`,
				"| stats count(*) as charges by bin(1d), event",
			].join(" "),
			x: 0, y: 58, width: 12, height: 8,
			view: "timeSeries",
		}),
		logWidget({
			region,
			title: "Cancellations by reason",
			logGroupNames: subscriptionLogGroupNames,
			query: [
				"fields @timestamp, reason",
				`| filter stream = "${STREAMS.subscriptions}" and event = "${SUBSCRIPTION_EVENTS.cancelled}"`,
				"| stats count(*) as cancels by reason",
				"| sort cancels desc",
			].join(" "),
			x: 12, y: 58, width: 12, height: 8,
			view: "pie",
		}),
		logWidget({
			region,
			title: "Recent subscription state-changes",
			logGroupNames: subscriptionLogGroupNames,
			query: [
				"fields @timestamp, event, user_id, subscription_id, reason",
				`| filter stream = "${STREAMS.subscriptions}"`,
				"| sort @timestamp desc",
				"| limit 50",
			].join(" "),
			x: 0, y: 66, width: 24, height: 8,
			view: "table",
		}),
	);

	// --- View ("try the reader") funnel ---
	// The pageview middleware cannot see /view (hx-request + redirect chain), so
	// these widgets are driven by the explicit view_opened / view_save_intent
	// events. Counting distinct visitor_id makes the funnel joinable to
	// user_created, which now also carries visitor_id.

	widgets.push(
		logWidget({
			region,
			title: "Reader Tries per Day (anonymous, distinct visitors)",
			logGroupNames: [hutchLogGroupName],
			query: [
				"fields @timestamp, visitor_id",
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.viewOpened}"`,
				"| filter is_authenticated = 0 and ispresent(visitor_id)",
				...exclude,
				"| stats count_distinct(visitor_id) as reader_tries by bin(1d)",
			].join(" "),
			x: 0, y: 74, width: 12, height: 8,
			view: "timeSeries",
		}),
		logWidget({
			region,
			title: "Try → Save-intent → Signup (unique visitors by event)",
			logGroupNames: [hutchLogGroupName],
			/**
			 * The save-intent leg is pinned to the anonymous reader surface so this
			 * funnel keeps its original meaning now that `view_save_intent` also
			 * fires for authenticated saves on the queue/extension surfaces.
			 * `not ispresent(surface)` keeps pre-enrichment events (which had no
			 * surface and were all anonymous reader saves) in the count.
			 */
			query: [
				"fields visitor_id",
				`| filter (stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.viewOpened}") or (stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.viewSaveIntent}" and (surface = "${SAVE_SURFACES.readerView}" or not ispresent(surface))) or (stream = "${STREAMS.conversions}" and event = "${CONVERSION_EVENTS.userCreated}")`,
				"| filter ispresent(visitor_id)",
				...exclude,
				"| stats count_distinct(visitor_id) as visitors by event",
				"| sort visitors desc",
			].join(" "),
			x: 12, y: 74, width: 12, height: 8,
			view: "bar",
		}),
	);

	// --- Internal clicks ("where do readers click most") ---
	// Driven by the `click` event the analytics middleware emits for any request
	// carrying utm_medium=internal — including HTMX-boosted links and POST
	// actions that never appear as pageviews. utm_source is the section and
	// utm_content the element.

	widgets.push(
		logWidget({
			region,
			title: "Internal clicks by section / element",
			logGroupNames: [hutchLogGroupName],
			query: [
				"fields @timestamp, coalesce(utm_source, \"-\") as section, coalesce(utm_content, \"-\") as element",
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.click}"`,
				...exclude,
				"| stats count(*) as clicks by section, element",
				"| sort clicks desc",
				"| limit 50",
			].join(" "),
			x: 0, y: 82, width: 24, height: 8,
			view: "table",
		}),
	);

	// --- Save funnel (content class × surface × outcome) ---
	// Driven by the enriched view_save_intent event. content_class is derived
	// from the article's own domain (never the referrer). coalesce() folds
	// pre-enrichment events — which carried no surface/outcome and were all
	// anonymous reader saves — into the reader_view / prompted_to_sign_up
	// buckets so historical data still reads correctly.

	widgets.push(
		logWidget({
			region,
			title: "Save-intent by surface × content class",
			logGroupNames: [hutchLogGroupName],
			query: [
				`fields coalesce(surface, "${SAVE_SURFACES.readerView}") as surface, coalesce(content_class, "unclassified") as content_class`,
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.viewSaveIntent}"`,
				...exclude,
				"| stats count(*) as saves by surface, content_class",
				"| sort saves desc",
				"| limit 50",
			].join(" "),
			x: 0, y: 90, width: 12, height: 8,
			view: "table",
		}),
		logWidget({
			region,
			title: "Save-intent by content class (own vs third-party, %)",
			logGroupNames: [hutchLogGroupName],
			query: [
				"fields coalesce(content_class, \"unclassified\") as content_class",
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.viewSaveIntent}"`,
				...exclude,
				"| stats count(*) as saves by content_class",
				"| sort saves desc",
			].join(" "),
			x: 12, y: 90, width: 12, height: 8,
			view: "pie",
		}),
		logWidget({
			region,
			title: "Anonymous reader-view save attempts by outcome",
			logGroupNames: [hutchLogGroupName],
			query: [
				`fields coalesce(outcome, "${SAVE_OUTCOMES.promptedToSignUp}") as outcome`,
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.viewSaveIntent}"`,
				`| filter (surface = "${SAVE_SURFACES.readerView}" or not ispresent(surface)) and is_authenticated = 0`,
				...exclude,
				"| stats count(*) as attempts by outcome",
				"| sort attempts desc",
			].join(" "),
			x: 0, y: 98, width: 12, height: 8,
			view: "bar",
		}),
	);

	return { widgets };
}

/**
 * Re-export so the dashboard's default log group set is co-located with the
 * widget builder and any future addition / rename surfaces through this one
 * module rather than via independent edits to events.ts and the Pulumi index.
 */
export const SUBSCRIPTION_DASHBOARD_LOG_GROUPS: readonly string[] = [
	LOG_GROUPS.subscriptionStartRequest,
	LOG_GROUPS.subscriptionChargeSucceeded,
	LOG_GROUPS.subscriptionChargeFailed,
	LOG_GROUPS.cancelSubscription,
	LOG_GROUPS.handleSubscriptionCancelled,
	LOG_GROUPS.scheduleTrialFeedbackEmail,
	LOG_GROUPS.sendTrialFeedbackEmail,
];
