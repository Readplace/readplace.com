import assert from "node:assert";
import { BLOG_SITE_LOG_GROUP } from "@packages/hutch-infra-components";
import { campaignTag, HOMEPAGE_SPLIT } from "../web/experiments/homepage-split";
import { SAVE_LINK_TOOL } from "../web/mcp/tool-definitions";
import { READLIST_PATH } from "../web/pages/readlist/readlist.url";
import { type ExcludedIdentities, excludeInternalVisitorsClauses } from "./excluded-identities";
import {
	ANALYTICS_EVENTS,
	CONVERSION_EVENTS,
	LOG_GROUPS,
	MCP_TOOL_OUTCOMES,
	METRICS,
	SAVE_OUTCOMES,
	SAVE_SURFACES,
	STREAMS,
	SUBSCRIPTION_EVENTS,
} from "./events";
import { ANALYTICS_METRIC_FILTERS, ANALYTICS_METRIC_NAMESPACE } from "./metric-filters";

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

export interface BuildAnalyticsDashboardDeps extends ExcludedIdentities {
	region: string;
	hutchLogGroupName: string;
	/** The never-expire destination group every analytics widget reads from. The
	 * forwarder copies the analytics streams out of every source group into here,
	 * so a widget scans only analytics bytes (roughly half the source volume) and
	 * queries reach the full retained history rather than the source's 30 days. */
	analyticsLogGroupName: string;
	/** The single group every source funnels its error output into. The error
	 * widget reads only this, which is what makes fleet coverage independent of
	 * anyone remembering to register a project — and what keeps the widget under
	 * the 50-log-group Logs Insights cap the account has already outgrown. */
	errorsLogGroupName: string;
}

/**
 * Dashboard log widgets prepend each log group with its own `SOURCE` keyword
 * and join them with `|`. The `logGroups(namePrefix: [...])` function exists
 * only for the start-query CLI/API and the dashboard renderer rejects it with
 * `Invalid NamePrefix: "namePrefix: ["`.
 */
function sourceClause(logGroupNames: readonly string[]): string {
	assert(logGroupNames.length > 0, "sourceClause requires at least one log group name");
	return logGroupNames.map((n) => `SOURCE '${n}'`).join(" | ");
}

/**
 * Now that every source group's analytics lines land in the one destination
 * group, a widget that used to be scoped by *which* group it read must re-scope
 * by origin. The forwarder names each destination stream `<sourceGroup>/<stream>`,
 * so `@logStream like "<sourceGroup>/"` keeps only lines that came from that
 * source (and `not like` drops them). The double-quoted form is a substring match,
 * not a regex, so the slashes in the group name are literal; the trailing slash
 * stops `hutch-handler` from also matching `hutch-handler-role`.
 */
function originClause(params: { logGroupName: string; match: "like" | "not like" }): string {
	return `| filter @logStream ${params.match} "${params.logGroupName}/"`;
}

/**
 * Which Lambdas legitimately emit the `subscriptions` stream, so the
 * state-changes widget can name its origins instead of excluding one.
 *
 * It used to read `not like "hutch-handler/"` — correct when hutch and the
 * subscription Lambdas were the only things in the analytics group, and silently
 * wrong the moment anything else forwards. An excluding filter admits every
 * origin nobody thought about, so each new project would have been swept into a
 * widget about subscription state with no code change and no failure.
 *
 * Keyed off LOG_GROUPS — whose keys events.ts pins to LAMBDA_NAMES' — so adding
 * a Lambda is a compile error here until somebody decides. `undefined` is the
 * answer for most of them; the point is that it is an answer, not a default.
 */
const SUBSCRIPTION_EVENT_EMITTERS = {
	// Emits checkout events on this stream, but this widget is about the
	// Lambda-driven state machine, so it stays out — the exclusion this record
	// replaces existed for exactly this one case.
	hutchHandler: undefined,
	subscriptionEvents: LOG_GROUPS.subscriptionEvents,
	sendTrialFeedbackEmail: LOG_GROUPS.sendTrialFeedbackEmail,
} as const satisfies Record<keyof typeof LOG_GROUPS, string | undefined>;

type SubscriptionEventOrigin = Exclude<
	(typeof SUBSCRIPTION_EVENT_EMITTERS)[keyof typeof SUBSCRIPTION_EVENT_EMITTERS],
	undefined
>;

/** The origins the state-changes widget accepts: every emitter that named a log
 * group. Holds the values, not the keys, so no cast is needed to index back. */
const SUBSCRIPTION_EVENT_ORIGINS: readonly string[] = Object.values(
	SUBSCRIPTION_EVENT_EMITTERS,
).filter((logGroup): logGroup is SubscriptionEventOrigin => logGroup !== undefined);

/** An OR of `like` clauses, so only the named origins can appear. */
function anyOriginClause(logGroupNames: readonly string[]): string {
	assert(logGroupNames.length > 0, "anyOriginClause needs at least one origin");
	const legs = logGroupNames.map((name) => `@logStream like "${name}/"`).join(" or ");
	return `| filter (${legs})`;
}

/**
 * The authenticated reader permalink, as a Logs Insights regex literal. Derived
 * from READLIST_PATH so it cannot drift from the mount point the path is built
 * from — the previous hand-written pattern matched `/<id>/view`, one segment
 * short of the real `/queue/<id>/view`, so the widget silently plotted nothing.
 */
const READER_VIEW_PATH_PATTERN = `/^${READLIST_PATH.replaceAll("/", "\\/")}\\/[^\\/]+\\/view$/`;

const READER_SAVE_SURFACES = [SAVE_SURFACES.readerView] as const;

function readerSaveSurfaceClause(): string {
	const list = READER_SAVE_SURFACES.map((surface) => `"${surface}"`).join(", ");
	return `(surface in [${list}] or not ispresent(surface))`;
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
	const { region, hutchLogGroupName, analyticsLogGroupName, errorsLogGroupName } = deps;
	const exclude = excludeInternalVisitorsClauses(deps);
	const widgets: DashboardWidget[] = [];

	/** Every analytics widget reads the single never-expire destination group. The
	 * forwarder has already merged both frontends' (app + blog) analytics lines
	 * into it, so an audience query still spans every frontend while scanning only
	 * analytics bytes. Widgets that need a single frontend re-scope by origin via
	 * `originClause` rather than by log group. */
	const analyticsSource = [analyticsLogGroupName];
	const pageviewLogGroups = analyticsSource;

	// --- Traffic + Audience ---

	widgets.push(
		logWidget({
			region,
			title: "Pageviews by utm_source (%)",
			logGroupNames: pageviewLogGroups,
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
			logGroupNames: pageviewLogGroups,
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
			logGroupNames: pageviewLogGroups,
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
			logGroupNames: pageviewLogGroups,
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
			logGroupNames: analyticsSource,
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
			logGroupNames: analyticsSource,
			query: [
				"fields @timestamp, visitor_hash, path, is_authenticated",
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.pageview}"`,
				// Insurance: the reader-view path only exists on the app. Scoping to
				// hutch origin keeps a future blog path collision out of the count.
				originClause({ logGroupName: hutchLogGroupName, match: "like" }),
				"| filter ispresent(visitor_hash)",
				...exclude,
				"| filter is_authenticated",
				`| filter path like ${READER_VIEW_PATH_PATTERN}`,
				"| stats count_distinct(visitor_hash) as reader_opens by bin(1d)",
			].join(" "),
			x: 12, y: 16, width: 12, height: 8,
			view: "timeSeries",
		}),
		logWidget({
			region,
			title: "Pageviews — UTM detail (all params)",
			logGroupNames: pageviewLogGroups,
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

	widgets.push(
		logWidget({
			region,
			title: "Conversions by Source (unique users)",
			logGroupNames: analyticsSource,
			query: [
				"fields @timestamp, user_id, coalesce(utm_source, referrer_host, \"direct\") as source",
				`| filter stream = "${STREAMS.conversions}" and event = "${CONVERSION_EVENTS.userCreated}"`,
				...exclude,
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
			logGroupNames: analyticsSource,
			query: [
				"fields @timestamp, user_id, coalesce(utm_source, referrer_host, \"direct\") as source, tier",
				`| filter stream = "${STREAMS.conversions}" and event = "${CONVERSION_EVENTS.userCreated}"`,
				...exclude,
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
			logGroupNames: analyticsSource,
			query: [
				"fields @timestamp, user_id, method, tier, oauth_client_id, homepage_variant, utm_source, utm_medium, utm_campaign, utm_content, referrer_host, landing_path, first_seen_at",
				`| filter stream = "${STREAMS.conversions}" and event = "${CONVERSION_EVENTS.userCreated}"`,
				...exclude,
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
		 * https://medium.com/p/<id>. Scoped to hutch origin: the blog runs the same
		 * middleware and also emits `medium_post_id`, so without this the shared
		 * analytics group would fold blog clicks into the app's Medium totals.
		 */
		logWidget({
			region,
			title: "Top Medium Posts by Clicks",
			logGroupNames: analyticsSource,
			query: [
				"fields @timestamp, medium_post_id",
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.pageview}"`,
				originClause({ logGroupName: hutchLogGroupName, match: "like" }),
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
			logGroupNames: analyticsSource,
			query: [
				"fields @timestamp, event",
				`| filter stream = "${STREAMS.analytics}"`,
				`| filter event in ["${ANALYTICS_EVENTS.importUploaded}", "${ANALYTICS_EVENTS.importFromUrlAcquired}", "${ANALYTICS_EVENTS.importCommitted}"]`,
				...exclude,
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
			logGroupNames: analyticsSource,
			query: [
				"fields @timestamp, event",
				`| filter stream = "${STREAMS.subscriptions}"`,
				`| filter event in ["${SUBSCRIPTION_EVENTS.chargeSucceeded}", "${SUBSCRIPTION_EVENTS.chargeFailed}"]`,
				...exclude,
				"| stats count(*) as charges by bin(1d), event",
			].join(" "),
			x: 0, y: 58, width: 12, height: 8,
			view: "timeSeries",
		}),
		logWidget({
			region,
			title: "Cancellations by reason",
			logGroupNames: analyticsSource,
			query: [
				"fields @timestamp, reason",
				`| filter stream = "${STREAMS.subscriptions}" and event = "${SUBSCRIPTION_EVENTS.cancelled}"`,
				...exclude,
				"| stats count(*) as cancels by reason",
				"| sort cancels desc",
			].join(" "),
			x: 12, y: 58, width: 12, height: 8,
			view: "pie",
		}),
		logWidget({
			region,
			title: "Recent subscription state-changes",
			logGroupNames: analyticsSource,
			query: [
				"fields @timestamp, event, user_id, subscription_id, reason",
				`| filter stream = "${STREAMS.subscriptions}"`,
				// Names its origins rather than excluding hutch's: an excluding filter
				// admits every origin nobody thought about, and the analytics group now
				// receives lines from every project in the fleet.
				anyOriginClause(SUBSCRIPTION_EVENT_ORIGINS),
				...exclude,
				"| sort @timestamp desc",
				"| limit 50",
			].join(" "),
			x: 0, y: 66, width: 24, height: 8,
			view: "table",
		}),
	);

	// --- View ("try the reader") funnel ---
	// Driven by the explicit view_opened / view_save_intent events. Counting
	// distinct visitor_id makes the funnel joinable to user_created, which also
	// carries visitor_id.

	widgets.push(
		logWidget({
			region,
			title: "Reader Tries per Day (anonymous, distinct visitors)",
			logGroupNames: analyticsSource,
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
			title: "Try → Save-intent (reader CTAs only) → Signup (unique visitors by event)",
			logGroupNames: analyticsSource,
			query: [
				"fields visitor_id",
				`| filter (stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.viewOpened}") or (stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.viewSaveIntent}" and ${readerSaveSurfaceClause()}) or (stream = "${STREAMS.conversions}" and event = "${CONVERSION_EVENTS.userCreated}")`,
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
			logGroupNames: pageviewLogGroups,
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

	// --- Save funnel ---
	// Driven by the enriched view_save_intent event. content_class is derived
	// from the article's own domain (never the referrer). coalesce() folds
	// pre-enrichment events — which carried no surface/outcome and were all
	// anonymous reader saves — into the reader_view / prompted_to_sign_up
	// buckets so historical data still reads correctly.
	// Aliased to `save_client`, not `client`: Logs Insights drops the column
	// when `coalesce(x, …) as x` self-aliases a field absent from every record
	// in range — which is all history before this event carried one.

	widgets.push(
		logWidget({
			region,
			title: "Save-intent by surface × client × content class",
			logGroupNames: analyticsSource,
			query: [
				`fields coalesce(surface, "${SAVE_SURFACES.readerView}") as surface, coalesce(client, "unclassified") as save_client, coalesce(content_class, "unclassified") as content_class`,
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.viewSaveIntent}"`,
				...exclude,
				"| stats count(*) as saves by surface, save_client, content_class",
				"| sort saves desc",
				"| limit 50",
			].join(" "),
			x: 0, y: 90, width: 12, height: 8,
			view: "table",
		}),
		logWidget({
			region,
			title: "Save-intent by content class (own vs third-party, %)",
			logGroupNames: analyticsSource,
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
			title: "Anonymous reader save prompts (reader_view, pre-surface history)",
			logGroupNames: analyticsSource,
			query: [
				`fields coalesce(outcome, "${SAVE_OUTCOMES.promptedToSignUp}") as outcome`,
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.viewSaveIntent}"`,
				`| filter ${readerSaveSurfaceClause()} and is_authenticated = 0`,
				...exclude,
				"| stats count(*) as attempts by outcome",
				"| sort attempts desc",
			].join(" "),
			x: 0, y: 98, width: 12, height: 8,
			view: "bar",
		}),
		/** Save failures the user actually hit, by surface — a save-funnel signal.
		 * Placed at x:12 y:146 (next free 12-wide slot, beside the checkout
		 * conversions widget) because the y:122–146 rows below the funnel are taken
		 * by the Homepage A/B, blog-pageviews, signup-form, and checkout-funnel widgets. */
		logWidget({
			region,
			title: "Save errors by surface (view_save_intent outcome=error)",
			logGroupNames: analyticsSource,
			query: [
				`fields coalesce(surface, "${SAVE_SURFACES.readerView}") as surface`,
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.viewSaveIntent}" and outcome = "${SAVE_OUTCOMES.error}"`,
				...exclude,
				"| stats count(*) as save_errors by surface",
				"| sort save_errors desc",
			].join(" "),
			x: 12, y: 146, width: 12, height: 8,
			view: "bar",
		}),
		logWidget({
			region,
			title: "Anonymous save-intent by device class / browser",
			logGroupNames: analyticsSource,
			query: [
				"fields @timestamp, concat(coalesce(device_class, \"unclassified\"), \" / \", coalesce(browser, \"-\")) as device_browser",
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.viewSaveIntent}" and is_authenticated = 0`,
				...exclude,
				"| stats count(*) as save_intents by device_browser",
				"| sort save_intents desc",
				"| limit 10",
			].join(" "),
			x: 12, y: 154, width: 12, height: 8,
			view: "bar",
		}),
	);

	// --- Summary (TL;DR) engagement ---
	// Driven by the summary_toggled event the internal reader's beacon emits on
	// every TL;DR open/close. Counting by state distinguishes deliberate opens
	// from dismissals because the internal reader ships the TL;DR collapsed by default.

	widgets.push(
		logWidget({
			region,
			title: "TL;DR toggles by state (open vs closed)",
			logGroupNames: analyticsSource,
			query: [
				"fields @timestamp, state",
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.summaryToggled}"`,
				...exclude,
				"| stats count(*) as toggles by state",
				"| sort toggles desc",
			].join(" "),
			x: 12, y: 98, width: 12, height: 8,
			view: "bar",
		}),
	);

	// --- Audience device mix ---
	// Which devices the audience actually uses. Driven by device_class on the
	// pageview event, which the analytics middleware only logs after shouldLog
	// drops bot user-agents — so this is a human-device signal spanning every
	// visitor, not just the small authenticated-reader cohort article_read
	// carries a device_class for. ispresent(device_class) excludes pageviews
	// logged before the field shipped; device_class != "other" drops the
	// no-User-Agent bucket (classifyDeviceClass's no-signal fallback, reachable
	// because isbot(undefined) is false) so the mix reads as real devices, not a
	// phantom "other" slice. Caveat: an iPad in Safari's default desktop mode
	// sends a Mac User-Agent and counts as desktop — a UA-only limitation that
	// undercounts tablets.
	// The pie's slices are the composite device_class / browser key (mirroring the
	// Source / Medium / Content pie): coalesce(browser, "-") folds pageviews logged
	// before the browser field shipped into a visible "<device> / -" slice rather
	// than dropping them, and | limit 10 caps the raised cardinality (devices ×
	// browsers) to the top slices, matching the UTM-path pie.

	widgets.push(
		logWidget({
			region,
			title: "Pageviews by device class / browser (%)",
			logGroupNames: pageviewLogGroups,
			query: [
				"fields @timestamp, device_class, browser, concat(device_class, \" / \", coalesce(browser, \"-\")) as device_browser",
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.pageview}"`,
				...exclude,
				"| filter ispresent(device_class) and device_class != \"other\"",
				"| stats count(*) as pageviews by device_browser",
				"| sort pageviews desc",
				"| limit 10",
			].join(" "),
			x: 0, y: 106, width: 12, height: 8,
			view: "pie",
		}),
		logWidget({
			region,
			title: "Distinct visitors by device class per day",
			logGroupNames: pageviewLogGroups,
			query: [
				"fields @timestamp, visitor_hash, device_class",
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.pageview}"`,
				"| filter ispresent(visitor_hash) and ispresent(device_class) and device_class != \"other\"",
				...exclude,
				"| stats count_distinct(visitor_hash) as visitors by device_class, bin(1d)",
			].join(" "),
			x: 12, y: 106, width: 12, height: 8,
			view: "timeSeries",
		}),
	);

	// --- Errors ---
	// A standing table of the most recent error output across the WHOLE fleet, so
	// surfacing "the latest logError occurrences" is a live view rather than an
	// ad-hoc Logs Insights query.
	//
	// It reads one group, not a list of them, and that is the point. Logs Insights
	// caps a query at 50 log groups (verified: 51 returns "Too many log groups
	// specified") and the account holds 71, so the previous enumerating form could
	// not cover the fleet even in principle — and what it omitted was invisible
	// rather than an error. The forwarder funnels every source group's error output
	// into ERRORS_LOG_GROUP, so a project that has never been heard of is covered
	// the moment it creates a Lambda.
	//
	// @logStream carries the origin as `<sourceGroup>/<sourceStream>`, replacing the
	// `source` field the old per-group form leaned on. coalesce(message, reason)
	// folds the human-readable detail from the logError and parse-error shapes into
	// a single column.
	//
	// There is deliberately NO `filter` clause. Membership of this log group IS the
	// filter: the forwarder classifies each line and writes only what it routed to
	// the errors funnel, so re-testing `level = "ERROR"` here would apply the
	// per-source-group logic to an already-classified stream.
	//
	// That is not theoretical. The filter this replaces matched nothing in
	// production: a Lambda-Text line carries its level in the preamble
	// (`<ts>\t<reqId>\tERROR\t<json>`), and `extractJsonPayload` strips that
	// preamble so Logs Insights can discover the JSON fields this table displays.
	// The stored line therefore has no `level` field and no "ERROR" substring —
	// the classifier saw the level, the widget could not, and every forwarded error
	// was invisible while the funnel filled correctly underneath it.
	widgets.push(
		logWidget({
			region,
			title: "Recent errors (logError + parse-errors, whole fleet)",
			logGroupNames: [errorsLogGroupName],
			query: [
				"fields @timestamp, level, @logStream as origin, url, coalesce(message, reason) as detail, @message, stack",
				"| sort @timestamp desc",
				"| limit 100",
			].join(" "),
			x: 0, y: 114, width: 24, height: 8,
			view: "table",
		}),
	);

	// --- Homepage A/B experiment ---
	// The `/` render stamps experiment=<campaignTag> + experiment_variant=<slug> on
	// its own pageview, and the signup path stamps homepage_variant=<slug> on the
	// user_created conversion, so the arm can be read on both legs. `campaignTag`
	// folds the epoch into the campaign, so a re-bucket scopes these widgets to the
	// new era rather than averaging the previous one in.
	//
	// The utm_campaign leg is the same epoch's earlier mechanism, when the arm was
	// picked client-side and the exposure was the redirect's own landing pageview.
	// Both legs are matched so this epoch's window reads continuously across the
	// switch; it can go once the epoch is bumped.
	//
	// The denominator is `visitor_id` (the sticky first-party cookie identity the
	// conversion also carries), not `visitor_hash` (a salted IP hash that collapses
	// people behind shared NAT and is not the id a signup joins on).

	const exposureFilter = `(experiment = "${campaignTag(HOMEPAGE_SPLIT)}" or utm_campaign = "${campaignTag(HOMEPAGE_SPLIT)}")`;

	widgets.push(
		logWidget({
			region,
			title: "Homepage A/B — distinct visitors and landings by variant",
			logGroupNames: analyticsSource,
			query: [
				"fields @timestamp, visitor_id, coalesce(experiment_variant, utm_content) as arm",
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.pageview}" and ${exposureFilter}`,
				...exclude,
				"| stats count_distinct(visitor_id) as visitors, count(*) as landings by arm",
				"| sort visitors desc",
			].join(" "),
			x: 0, y: 122, width: 12, height: 8,
			view: "bar",
		}),
	);

	// Assigned visitors vs signups, per arm, in one bar so the conversion rate is
	// visitors:signups per arm at a glance. The union filter puts the exposure
	// pageview and the user_created conversion on the same query; `arm` coalesces
	// the pageview's arm with the conversion's homepage_variant. homepage_variant
	// must outrank utm_content: a conversion also carries the acquisition
	// utm_content spread from hutch_click, which would otherwise bin the signup
	// under a phantom arm (e.g. an ad's utm_content). SRM check:
	// the two `pageview` bars must stay within a few percent — a skew means an arm
	// is erroring and the read is void.
	widgets.push(
		logWidget({
			region,
			title: "Homepage A/B — assigned visitors vs signups by arm",
			logGroupNames: analyticsSource,
			query: [
				"fields @timestamp, visitor_id, coalesce(experiment_variant, homepage_variant, utm_content) as arm",
				`| filter (stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.pageview}" and ${exposureFilter}) or (stream = "${STREAMS.conversions}" and event = "${CONVERSION_EVENTS.userCreated}" and ispresent(homepage_variant))`,
				...exclude,
				"| filter ispresent(visitor_id)",
				"| stats count_distinct(visitor_id) as visitors by arm, event",
				"| sort arm asc",
			].join(" "),
			x: 0, y: 162, width: 12, height: 8,
			view: "bar",
		}),
		logWidget({
			region,
			title: "Homepage A/B — signups by arm × tier",
			logGroupNames: analyticsSource,
			query: [
				"fields @timestamp, user_id, homepage_variant, tier",
				`| filter stream = "${STREAMS.conversions}" and event = "${CONVERSION_EVENTS.userCreated}" and ispresent(homepage_variant)`,
				...exclude,
				"| stats count_distinct(user_id) as signups by homepage_variant, tier",
				"| sort signups desc",
			].join(" "),
			x: 12, y: 162, width: 12, height: 8,
			view: "table",
		}),
	);

	// --- Blog traffic ---
	// The blog Lambda's pageviews now land in the shared analytics group alongside
	// the app's, so this table re-scopes to blog origin via @logStream and ranks
	// the most visited blog paths.

	widgets.push(
		logWidget({
			region,
			title: "Blog pageviews by path",
			logGroupNames: analyticsSource,
			query: [
				"fields @timestamp, path",
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.pageview}"`,
				originClause({ logGroupName: BLOG_SITE_LOG_GROUP, match: "like" }),
				...exclude,
				"| stats count(*) as pageviews by path",
				"| sort pageviews desc",
				"| limit 25",
			].join(" "),
			x: 12, y: 122, width: 12, height: 8,
			view: "table",
		}),
	);

	widgets.push(
		logWidget({
			region,
			title: "Email signup form outcomes",
			logGroupNames: analyticsSource,
			query: [
				"fields @timestamp, outcome",
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.signupAttempted}"`,
				...exclude,
				"| stats count(*) as attempts by outcome",
				"| sort attempts desc",
			].join(" "),
			x: 0, y: 130, width: 12, height: 8,
			view: "bar",
		}),
		logWidget({
			region,
			title: "Email signup form outcomes per day",
			logGroupNames: analyticsSource,
			query: [
				"fields @timestamp, outcome",
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.signupAttempted}"`,
				...exclude,
				"| stats count(*) as attempts by bin(1d), outcome",
			].join(" "),
			x: 12, y: 130, width: 12, height: 8,
			view: "timeSeries",
		}),
	);

	// --- Checkout funnel ---
	// These events are emitted by the hutch web app (POST /account/subscribe and
	// GET /auth/checkout/success), not the subscription Lambdas, so the widget
	// sources the hutch handler log group.

	const checkoutFunnelFilter = [
		`| filter stream = "${STREAMS.subscriptions}"`,
		`| filter event in ["${SUBSCRIPTION_EVENTS.checkoutStarted}", "${SUBSCRIPTION_EVENTS.checkoutCompleted}", "${SUBSCRIPTION_EVENTS.checkoutReturnFailed}"]`,
	];

	widgets.push(
		logWidget({
			region,
			title: "Checkout funnel per day",
			logGroupNames: analyticsSource,
			// Distinct users, not raw counts: checkout_started fires once per Subscribe
			// click, so abandon-and-retry would inflate the conversion denominator.
			query: [
				"fields @timestamp, event",
				...checkoutFunnelFilter,
				...exclude,
				"| stats count_distinct(user_id) as users, count(*) as events by bin(1d), event",
			].join(" "),
			x: 0, y: 138, width: 12, height: 8,
			view: "timeSeries",
		}),
		logWidget({
			region,
			title: "Checkout funnel detail (variant / reason)",
			logGroupNames: analyticsSource,
			query: [
				"fields @timestamp, event, variant, reason",
				...checkoutFunnelFilter,
				...exclude,
				`| stats count(*) as n by event, coalesce(variant, reason, "-") as detail`,
				"| sort n desc",
			].join(" "),
			x: 12, y: 138, width: 12, height: 8,
			view: "bar",
		}),
		logWidget({
			region,
			title: "Conversions per day — real charges vs $0 trial captures",
			logGroupNames: analyticsSource,
			// A completed checkout is not necessarily revenue: a trial-preserving
			// checkout captures a card for $0 (paid_now:false). A saved-card
			// resubscribe charges immediately and never touches Stripe Checkout, so it
			// has no checkout_started/completed pair and is counted on its own event.
			query: [
				"fields @timestamp, event, paid_now",
				`| filter stream = "${STREAMS.subscriptions}"`,
				`| filter event in ["${SUBSCRIPTION_EVENTS.checkoutCompleted}", "${SUBSCRIPTION_EVENTS.resubscribeCompleted}"]`,
				...exclude,
				"| stats count_distinct(user_id) as users by bin(1d), event, paid_now",
			].join(" "),
			x: 0, y: 146, width: 12, height: 8,
			view: "timeSeries",
		}),
	);

	// --- First-article autosave (activation) ---

	widgets.push(
		logWidget({
			region,
			title: "First-article autosaves per day",
			logGroupNames: analyticsSource,
			query: [
				"fields @timestamp, user_id, visitor_id",
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.firstArticleAutosaved}"`,
				...exclude,
				"| stats count(*) as autosaves by bin(1d)",
			].join(" "),
			x: 0, y: 154, width: 12, height: 8,
			view: "timeSeries",
		}),
	);

	// --- Connected AI assistants (MCP) ---

	widgets.push(
		logWidget({
			region,
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
			x: 0, y: 170, width: 12, height: 8,
			view: "table",
		}),
		logWidget({
			region,
			title: "MCP tool calls per day by outcome",
			logGroupNames: analyticsSource,
			query: [
				"fields @timestamp, outcome",
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.mcpToolCalled}"`,
				...exclude,
				"| stats count(*) as calls by bin(1d), outcome",
			].join(" "),
			x: 12, y: 170, width: 12, height: 8,
			view: "timeSeries",
		}),
		logWidget({
			region,
			title: "MCP users who called a tool but never saved",
			logGroupNames: analyticsSource,
			query: [
				"fields user_id, tool",
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.mcpToolCalled}"`,
				...exclude,
				`| stats count(*) as calls, sum(tool = "${SAVE_LINK_TOOL.name}" and outcome = "${MCP_TOOL_OUTCOMES.ok}") as saves by user_id`,
				"| sort calls desc",
				"| limit 50",
			].join(" "),
			x: 0, y: 178, width: 12, height: 8,
			view: "table",
		}),
	);

	widgets.push(
		logWidget({
			region,
			title: "Signups by OAuth client (consent-screen acquisition)",
			logGroupNames: analyticsSource,
			query: [
				"fields @timestamp, coalesce(oauth_client_id, \"none\") as client, method, tier",
				`| filter stream = "${STREAMS.conversions}" and event = "${CONVERSION_EVENTS.userCreated}"`,
				...exclude,
				"| stats count(*) as signups by client, method, tier",
				"| sort signups desc",
				"| limit 50",
			].join(" "),
			x: 12, y: 178, width: 12, height: 8,
			view: "table",
		}),
	);

	widgets.push(
		...Object.values(ANALYTICS_METRIC_FILTERS).map((filter, index) => ({
			type: "metric",
			x: index * 8, y: 186, width: 8, height: 4,
			properties: {
				region,
				title: filter.widgetTitle,
				metrics: [[ANALYTICS_METRIC_NAMESPACE, filter.metricName, { stat: "Sum" }]],
				period: 86400,
				stat: "Sum",
				view: "singleValue",
				sparkline: true,
				setPeriodToTimeRange: true,
			},
		})),
	);

	return { widgets };
}
