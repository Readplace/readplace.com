import assert from "node:assert/strict";
import {
	BLOG_SITE_LOG_GROUP,
	SAVE_LINK_LOG_GROUPS,
} from "@packages/hutch-infra-components";
import { campaignTag, HOMEPAGE_SPLIT } from "../web/experiments/homepage-split";
import { READLIST_PATH } from "../web/pages/readlist/readlist.url";
import {
	ANALYTICS_EVENTS,
	ANALYTICS_LOG_GROUP,
	CONVERSION_EVENTS,
	ERRORS_LOG_GROUP,
	LAMBDA_NAMES,
	LOG_GROUPS,
	METRICS,
	SAVE_SURFACES,
	STREAMS,
	SUBSCRIPTION_EVENTS,
} from "./events";
import { buildAnalyticsDashboardBody, type DashboardWidget } from "./analytics-dashboard";
import type { ExcludedIdentities } from "./excluded-identities";
import { ANALYTICS_METRIC_FILTERS, ANALYTICS_METRIC_NAMESPACE } from "./metric-filters";

const EXCLUDED_VISITOR_ID = "11111111-1111-4111-8111-111111111111";
const EXCLUDED_USER_ID = "22222222222222222222222222222222";

const ANY_STREAM_RE = /\bstream\s*=\s*"([a-z][a-z0-9_-]*)"/g;
const ANY_EVENT_RE = /\bevent\s*=\s*"([a-z][a-z0-9_]*)"/g;
const EVENT_IN_LIST_RE = /\bevent\s+in\s+\[([^\]]+)\]/g;

function buildBody(overrides: Partial<ExcludedIdentities> = {}) {
	return buildAnalyticsDashboardBody({
		region: "ap-southeast-2",
		hutchLogGroupName: LOG_GROUPS.hutchHandler,
		analyticsLogGroupName: ANALYTICS_LOG_GROUP,
		errorsLogGroupName: ERRORS_LOG_GROUP,
		excludedVisitorIds: overrides.excludedVisitorIds ?? [EXCLUDED_VISITOR_ID],
		excludedUserIds: overrides.excludedUserIds ?? [EXCLUDED_USER_ID],
	});
}

function widgetQueries(): string[] {
	return buildBody().widgets
		.map((w) => w.properties.query)
		.filter((q): q is string => typeof q === "string");
}

function collectMatches(re: RegExp, hay: string): string[] {
	const out: string[] = [];
	let m: RegExpExecArray | null;
	const r = new RegExp(re.source, re.flags);
	// biome-ignore lint/suspicious/noAssignInExpressions: standard exec loop
	while ((m = r.exec(hay)) !== null) {
		out.push(m[1]);
	}
	return out;
}

function collectReferencedStreams(): Set<string> {
	const found = new Set<string>();
	for (const q of widgetQueries()) {
		for (const name of collectMatches(ANY_STREAM_RE, q)) found.add(name);
	}
	return found;
}

function collectReferencedEvents(): Set<string> {
	const found = new Set<string>();
	for (const q of widgetQueries()) {
		for (const name of collectMatches(ANY_EVENT_RE, q)) found.add(name);
		for (const list of collectMatches(EVENT_IN_LIST_RE, q)) {
			for (const item of list.split(",")) {
				const trimmed = item.trim().replace(/^"|"$/g, "");
				if (trimmed) found.add(trimmed);
			}
		}
	}
	return found;
}

describe("buildAnalyticsDashboardBody — drift prevention", () => {
	it("emits 46 widgets (7 traffic+audience, 3 conversions, 3 imports+medium, 3 subscriptions, 2 view-funnel, 1 internal-clicks, 5 save-funnel, 1 summary-engagement, 2 audience-device, 1 errors, 3 homepage-ab, 1 blog-traffic, 2 signup-form, 2 checkout-funnel, 1 paid-conversions, 1 first-article-autosave, 3 mcp, 1 oauth-client-acquisition, 1 oauth-token-grants, 1 save-refusals, 3 key-event-counters) — adding or dropping one without updating this count is a deliberate signal to review the dashboard's scope", () => {
		const body = buildBody();
		expect(body.widgets).toHaveLength(47);
	});

	it("carries oauth_client_id on the recent-conversions table so a consent-screen signup names the client that sent it", () => {
		const recent = widgetQueries().find((q) => q.includes("landing_path, first_seen_at"));
		assert(recent, "the recent-conversions widget must exist");
		expect(recent).toContain("oauth_client_id");
	});

	it("buckets every signup by the OAuth client that drove it, keeping the consent-screen share readable against the organic \"none\" bucket", () => {
		const query = widgetQueries().find((q) => q.includes("as signups by client"));
		assert(query, "the dashboard must aggregate user_created by OAuth client");
		expect(query).toContain('coalesce(oauth_client_id, "none") as client');
		expect(query).toContain(`event = "${CONVERSION_EVENTS.userCreated}"`);
	});

	it("the first-article-autosave widget counts the discrete first_article_autosaved event per day — a 1:1 activation signal independent of the utm_source marker — excluding internal visitors, whose single test signup would skew a day at this event's volume", () => {
		const queries = widgetQueries();
		const autosave = queries.find((q) => q.includes(`event = "${ANALYTICS_EVENTS.firstArticleAutosaved}"`));
		expect(autosave).toBeDefined();
		expect(autosave?.startsWith(`SOURCE '${ANALYTICS_LOG_GROUP}' | `)).toBe(true);
		expect(autosave).toContain(`stream = "${STREAMS.analytics}"`);
		expect(autosave).toContain("visitor_id not in");
		expect(autosave).toContain("stats count(*) as autosaves by bin(1d)");
	});

	it("the homepage A/B landings widget compares arms by distinct visitor_id (the id the conversion also carries), filtered to the epoch-tagged campaign, with raw landings alongside", () => {
		const queries = widgetQueries();
		const ab = queries.find((q) =>
			q.includes("stats count_distinct(visitor_id) as visitors, count(*) as landings by arm"),
		);
		expect(ab).toBeDefined();
		expect(ab).toContain("coalesce(experiment_variant, utm_content) as arm");
		expect(ab).toContain(`experiment = "${campaignTag(HOMEPAGE_SPLIT)}"`);
		expect(ab).toContain(`event = "${ANALYTICS_EVENTS.pageview}"`);
		expect(ab).toContain("| sort visitors desc");
		expect(ab).not.toContain("count_distinct(visitor_hash)");
	});

	// This epoch spans both exposure mechanisms — the arm's own landing pageview
	// while the split ran client-side, and `/`'s own pageview now that the arm is
	// picked server-side — so both legs are matched or the window reads as a cliff.
	it("the homepage A/B widgets count an exposure from either the arm-tagged pageview or the earlier landing campaign", () => {
		for (const query of widgetQueries().filter((q) => q.includes("as arm"))) {
			expect(query).toContain(`experiment = "${campaignTag(HOMEPAGE_SPLIT)}"`);
			expect(query).toContain(`utm_campaign = "${campaignTag(HOMEPAGE_SPLIT)}"`);
		}
	});

	it("the homepage A/B conversion widget joins exposure pageviews and user_created signups on visitor_id, keyed by arm (the tagged arm on the pageview, homepage_variant on the conversion, before the acquisition utm_content a conversion also carries)", () => {
		const queries = widgetQueries();
		const byArm = queries.find((q) =>
			q.includes("stats count_distinct(visitor_id) as visitors by arm, event"),
		);
		expect(byArm).toBeDefined();
		expect(byArm).toContain("coalesce(experiment_variant, homepage_variant, utm_content) as arm");
		expect(byArm).toContain(`event = "${ANALYTICS_EVENTS.pageview}"`);
		expect(byArm).toContain(`event = "${CONVERSION_EVENTS.userCreated}"`);
		expect(byArm).toContain("ispresent(homepage_variant)");
	});

	it("the homepage A/B tier widget counts distinct signups per arm and tier", () => {
		const queries = widgetQueries();
		const byTier = queries.find((q) =>
			q.includes("stats count_distinct(user_id) as signups by homepage_variant, tier"),
		);
		expect(byTier).toBeDefined();
		expect(byTier).toContain(`event = "${CONVERSION_EVENTS.userCreated}"`);
		expect(byTier).toContain("ispresent(homepage_variant)");
	});

	it("audience pageview widgets read the single merged analytics group (both frontends already forwarded into it)", () => {
		const queries = widgetQueries();
		const distinctVisitors = queries.find((q) => q.includes("count_distinct(visitor_hash) as visitors by bin(1d)"));
		expect(distinctVisitors).toBeDefined();
		expect(distinctVisitors?.startsWith(`SOURCE '${ANALYTICS_LOG_GROUP}' | `)).toBe(true);
	});

	it("the blog-traffic widget reads the analytics group but re-scopes to blog origin via @logStream", () => {
		const queries = widgetQueries();
		const blog = queries.find((q) => q.includes("stats count(*) as pageviews by path"));
		expect(blog).toBeDefined();
		expect(blog?.startsWith(`SOURCE '${ANALYTICS_LOG_GROUP}' | `)).toBe(true);
		expect(blog).toContain(`| filter @logStream like "${BLOG_SITE_LOG_GROUP}/"`);
		expect(blog).toContain(`event = "${ANALYTICS_EVENTS.pageview}"`);
	});

	it("the readers widget counts distinct user_ids from article_read events (not pageviews) — distinguishes opening the reader from explicitly marking-as-read", () => {
		const queries = widgetQueries();
		const readers = queries.find((q) => q.includes("authenticated_unique_readers"));
		expect(readers).toBeDefined();
		expect(readers).toContain(`event = "${ANALYTICS_EVENTS.articleRead}"`);
		expect(readers).toContain("count_distinct(user_id)");
	});

	it("the opens widget counts distinct authenticated visitors on the reader view path — funnel companion to the readers widget", () => {
		const queries = widgetQueries();
		const opens = queries.find((q) => q.includes("reader_opens"));
		expect(opens).toBeDefined();
		expect(opens).toContain(`event = "${ANALYTICS_EVENTS.pageview}"`);
		expect(opens).toContain("\\/view$");
	});

	it("the opens widget's path pattern actually matches a real authenticated reader permalink — asserting only that the query mentions \\/view$ let a pattern one path segment short ship and plot nothing for weeks", () => {
		const opens = widgetQueries().find((q) => q.includes("reader_opens"));
		assert(opens, "the reader_opens widget must exist");
		const source = opens.match(/\| filter path like \/(\S+)\/ \|/)?.[1];
		assert(source, "the opens widget must filter on a regex literal");
		const pattern = new RegExp(source);
		expect(pattern.test(`${READLIST_PATH}/58b83c9aad6a5c0a32f6d8caa3a69bbc/view`)).toBe(true);
		expect(pattern.test("/view/example.com/some-article")).toBe(false);
		expect(pattern.test(READLIST_PATH)).toBe(false);
	});

	it("the device-mix widget slices pageviews by the composite device_class / browser key so the audience's device+browser usage is visible at pageview scale (not just the authenticated-reader cohort), excluding pageviews logged before the field shipped and the no-signal \"other\" (no-User-Agent) bucket so the pie reads as real devices", () => {
		const queries = widgetQueries();
		const device = queries.find((q) => q.includes("stats count(*) as pageviews by device_browser"));
		expect(device).toBeDefined();
		expect(device).toContain(`event = "${ANALYTICS_EVENTS.pageview}"`);
		expect(device).toContain('concat(device_class, " / ", coalesce(browser, "-")) as device_browser');
		expect(device).toContain('| filter ispresent(device_class) and device_class != "other"');
		expect(device).toContain("| limit 10");
	});

	it("the device-trend widget counts distinct visitors per device_class per day (excluding the no-signal \"other\" bucket) so the device mix is trackable over time", () => {
		const queries = widgetQueries();
		const trend = queries.find((q) => q.includes("count_distinct(visitor_hash) as visitors by device_class, bin(1d)"));
		expect(trend).toBeDefined();
		expect(trend).toContain(`event = "${ANALYTICS_EVENTS.pageview}"`);
		expect(trend).toContain('ispresent(visitor_hash) and ispresent(device_class) and device_class != "other"');
	});

	it("the internal-clicks widget surfaces utm_content as the element so the dashboard shows which tab/button was clicked (e.g. install-tabs → firefox), not just the section", () => {
		const queries = widgetQueries();
		const clicks = queries.find((q) => q.includes(`event = "${ANALYTICS_EVENTS.click}"`));
		expect(clicks).toBeDefined();
		expect(clicks).toContain('coalesce(utm_source, "-") as section');
		expect(clicks).toContain('coalesce(utm_content, "-") as element');
		expect(clicks).toContain("stats count(*) as clicks by section, element");
	});

	it("scopes the reader funnel to the reader_view surface plus the saves recorded before the surface dimension existed", () => {
		const queries = widgetQueries();
		const funnel = queries.find((q) => q.includes(`event = "${ANALYTICS_EVENTS.viewOpened}"`) && q.includes(`event = "${ANALYTICS_EVENTS.viewSaveIntent}"`));
		expect(funnel).toBeDefined();
		expect(funnel).toContain(`surface in ["${SAVE_SURFACES.readerView}"]`);
		expect(funnel).toContain("not ispresent(surface)");
	});

	it("scopes the anonymous reader outcome widget to the same reader surface the funnel uses", () => {
		const queries = widgetQueries();
		const outcomes = queries.find((q) => q.includes("stats count(*) as attempts by outcome") && q.includes("is_authenticated = 0"));
		expect(outcomes).toBeDefined();
		expect(outcomes).toContain(`surface in ["${SAVE_SURFACES.readerView}"]`);
		expect(outcomes).toContain("is_authenticated = 0");
	});

	it("breaks anonymous save-intent down by the device_class / browser the event now carries, so the client behind an anonymous save prompt is readable off the dashboard instead of a fuzzy timestamp join against an access log that expires", () => {
		const deviceBreakdown = widgetQueries().find((q) => q.includes("stats count(*) as save_intents by device_browser"));
		assert(deviceBreakdown, "the anonymous save-intent device breakdown widget must exist");
		expect(deviceBreakdown).toContain(`event = "${ANALYTICS_EVENTS.viewSaveIntent}"`);
		expect(deviceBreakdown).toContain("is_authenticated = 0");
		expect(deviceBreakdown).toContain('concat(coalesce(device_class, "unclassified"), " / ", coalesce(browser, "-")) as device_browser');
	});

	it("keeps the bot and no-User-Agent buckets in the anonymous save-intent breakdown — unlike pageview, no bot gate drops a save intent, and those two buckets are exactly the crawler population the widget exists to expose", () => {
		const deviceBreakdown = widgetQueries().find((q) => q.includes("stats count(*) as save_intents by device_browser"));
		assert(deviceBreakdown, "the anonymous save-intent device breakdown widget must exist");
		expect(deviceBreakdown).not.toContain('device_class != "other"');
		expect(deviceBreakdown).not.toContain("ispresent(device_class)");
	});

	it("leaves the by-surface breakdown unscoped, so every new save surface shows up as its own row without a dashboard change", () => {
		const queries = widgetQueries();
		const breakdown = queries.find((q) => q.includes("stats count(*) as saves by surface, save_client, content_class"));
		expect(breakdown).toBeDefined();
		expect(breakdown).not.toContain("surface in [");
	});

	it("the errors widget is a latest-first table over the errors funnel", () => {
		const errorWidget = buildBody().widgets.find(
			(w) => typeof w.properties.query === "string" && w.properties.query.includes("coalesce(message, reason) as detail"),
		);
		expect(errorWidget).toBeDefined();
		expect(errorWidget?.properties.view).toBe("table");
		const query = errorWidget?.properties.query;
		expect(query).toContain("| sort @timestamp desc");
		expect(query).toContain("| limit 100");
		expect(query).toContain(`SOURCE '${ERRORS_LOG_GROUP}' | fields @timestamp, level`);
	});

	// Regression guard for a bug that reached production: the widget re-tested
	// `level = "ERROR"` on lines whose level lived in the Lambda-Text preamble that
	// extractJsonPayload strips before forwarding. The funnel filled correctly and
	// the table stayed empty. Membership of the group is the classification, so any
	// filter here can only subtract from what the forwarder already decided.
	it("applies no filter — the forwarder already classified every line it wrote", () => {
		const errorWidget = buildBody().widgets.find(
			(w) => typeof w.properties.query === "string" && w.properties.query.includes("coalesce(message, reason) as detail"),
		);
		expect(errorWidget?.properties.query).not.toContain("| filter");
	});

	// This replaces a test that asserted every SAVE_LINK_LOG_GROUPS entry appeared
	// as its own SOURCE in the errors widget. That guarantee is gone because its
	// premise is gone: naming groups individually cannot scale past the 50-group
	// Logs Insights cap, and it only ever covered the groups someone remembered to
	// list — inbox and web-embed never were. Fleet coverage now comes from the
	// forwarder funnel, and is enforced where log groups are created rather than
	// where they are queried.
	it("names no per-project log group at all — naming one would reintroduce the 50-group cap the funnel exists to escape", () => {
		const errorQuery = widgetQueries().find((q) => q.includes("coalesce(message, reason) as detail"));
		expect(errorQuery).toBeDefined();
		expect(errorQuery).toContain(`SOURCE '${ERRORS_LOG_GROUP}'`);
		for (const logGroup of [...Object.values(SAVE_LINK_LOG_GROUPS), ...Object.values(LOG_GROUPS), BLOG_SITE_LOG_GROUP]) {
			expect(errorQuery).not.toContain(`SOURCE '${logGroup}'`);
		}
	});

	it("attributes an error to its origin via @logStream, which the funnel stamps as <sourceGroup>/<sourceStream>", () => {
		const errorQuery = widgetQueries().find((q) => q.includes("coalesce(message, reason) as detail"));
		expect(errorQuery).toContain("@logStream as origin");
	});

	it("every stream used by an emitter (STREAMS) is referenced by at least one widget query — adding a new stream without a widget fails CI", () => {
		const referenced = collectReferencedStreams();
		const declared = new Set(Object.values(STREAMS));
		// Streams no widget QUERY names.
		//
		// crawl-outcomes is genuinely unsurfaced — inspected only by ad-hoc Logs
		// Insights queries. Adding a crawl-outcome widget would drop it from here.
		//
		// parse-errors IS surfaced, by routing rather than by a query term: the
		// forwarder writes it into the errors funnel and the errors widget shows
		// everything in that group unfiltered. ERROR_STREAMS is what guarantees it
		// arrives, and observability-filter.test.ts is what guards that.
		const ignored = new Set<string>([
			STREAMS.crawlOutcomes,
			STREAMS.parseErrors,
		]);
		expect(ignored.size).toBe(2);
		const missing = [...declared].filter((s) => !referenced.has(s) && !ignored.has(s));
		expect(missing).toEqual([]);
	});

	it("every event in ANALYTICS_EVENTS / CONVERSION_EVENTS / SUBSCRIPTION_EVENTS is referenced by at least one widget query", () => {
		const referenced = collectReferencedEvents();
		const declared = [
			...Object.values(ANALYTICS_EVENTS),
			...Object.values(CONVERSION_EVENTS),
			...Object.values(SUBSCRIPTION_EVENTS),
		];
		const missing = declared.filter((e) => !referenced.has(e));
		expect(missing).toEqual([]);
	});

	it("every stream literal in a widget query is a declared STREAMS value (no manual-edit drift back to raw strings)", () => {
		const referenced = collectReferencedStreams();
		const declared = new Set<string>(Object.values(STREAMS));
		const unknown = [...referenced].filter((s) => !declared.has(s));
		expect(unknown).toEqual([]);
	});

	it("every event literal in a widget query is a declared *_EVENTS value (no manual-edit drift back to raw strings)", () => {
		const referenced = collectReferencedEvents();
		const declared = new Set<string>([
			...Object.values(ANALYTICS_EVENTS),
			...Object.values(CONVERSION_EVENTS),
			...Object.values(SUBSCRIPTION_EVENTS),
		]);
		const unknown = [...referenced].filter((e) => !declared.has(e));
		expect(unknown).toEqual([]);
	});

	function metricWidgetsIn(widgets: readonly DashboardWidget[], namespace: string) {
		return widgets.filter(
			(w) =>
				w.type === "metric" &&
				Array.isArray(w.properties.metrics) &&
				w.properties.metrics.some((m) => Array.isArray(m) && m[0] === namespace),
		);
	}

	it("references the Readplace/Imports metric so the singleValue widget is wired to the LogMetricFilter", () => {
		const metricWidgets = metricWidgetsIn(buildBody().widgets, METRICS.importsCompleted.namespace);
		expect(metricWidgets).toHaveLength(1);
		expect(metricWidgets[0]?.properties.metrics).toEqual([
			[METRICS.importsCompleted.namespace, METRICS.importsCompleted.name, { stat: "Sum" }],
		]);
	});

	it("gives every analytics metric filter its own counter widget, so a filter whose pattern stops matching reads as a visible flat zero instead of silently going missing from the dashboard", () => {
		const metricWidgets = metricWidgetsIn(buildBody().widgets, ANALYTICS_METRIC_NAMESPACE);
		expect(
			metricWidgets.map((w) => [w.properties.title, w.properties.metrics]),
		).toEqual(
			Object.values(ANALYTICS_METRIC_FILTERS).map((filter) => [
				filter.widgetTitle,
				[[ANALYTICS_METRIC_NAMESPACE, filter.metricName, { stat: "Sum" }]],
			]),
		);
	});

	it("lays the counter row out below every other widget and across the full 24-column grid, so moving the row cannot park it on top of the row above", () => {
		const widgets = buildBody().widgets;
		const counters = metricWidgetsIn(widgets, ANALYTICS_METRIC_NAMESPACE);
		const rowTop = Math.min(...counters.map((w) => w.y));
		const bottomOfTheRest = Math.max(
			...widgets.filter((w) => !counters.includes(w)).map((w) => w.y + w.height),
		);

		expect(new Set(counters.map((w) => w.y)).size).toBe(1);
		expect(rowTop).toBeGreaterThanOrEqual(bottomOfTheRest);
		expect(counters.map((w) => [w.x, w.x + w.width])).toEqual([
			[0, 8],
			[8, 16],
			[16, 24],
		]);
	});

	it("every log widget except the cross-group errors table reads only the never-expire analytics group — the scan-only-analytics-bytes invariant", () => {
		const prefix = `SOURCE '${ANALYTICS_LOG_GROUP}' | `;
		const nonErrorQueries = buildBody()
			.widgets.filter((w) => w.type === "log")
			.map((w) => w.properties.query)
			.filter((q): q is string => typeof q === "string")
			.filter((q) => !q.includes("coalesce(message, reason) as detail"));
		expect(nonErrorQueries.length).toBeGreaterThan(0);
		for (const q of nonErrorQueries) {
			expect(q.startsWith(prefix)).toBe(true);
		}
	});

	// The dashboard must reference ONLY groups its owning stack creates. That is
	// what lets it move to the platform stack, which deploys before every project
	// and so can never depend on a project-owned group existing.
	it("reads exactly two log groups, both funnel destinations", () => {
		const sources = new Set(
			widgetQueries().flatMap((q) => [...q.matchAll(/SOURCE '([^']+)'/g)].map((m) => m[1])),
		);
		expect([...sources].sort()).toEqual([ANALYTICS_LOG_GROUP, ERRORS_LOG_GROUP].sort());
	});

	it("the errors widget reads the errors funnel, not the analytics group", () => {
		const errorQuery = widgetQueries().find((q) => q.includes("coalesce(message, reason) as detail"));
		expect(errorQuery).toBeDefined();
		expect(errorQuery?.startsWith(`SOURCE '${ERRORS_LOG_GROUP}' | `)).toBe(true);
	});

	// Replaces a test that asserted the widget EXCLUDED hutch's origin. That shape
	// was correct only while hutch and the subscription Lambdas were the sole
	// occupants of the analytics group: an excluding filter admits every origin
	// nobody thought about, so each new project would have joined this widget
	// silently. It now names the origins it accepts.
	it("the subscription state-changes widget names its origins rather than excluding one", () => {
		const q = widgetQueries().find(
			(x) => x.includes("subscription_id, reason") && x.includes(`stream = "${STREAMS.subscriptions}"`),
		);
		expect(q).toBeDefined();
		expect(q?.startsWith(`SOURCE '${ANALYTICS_LOG_GROUP}' | `)).toBe(true);
		expect(q).not.toContain("not like");
		expect(q).toContain(`@logStream like "${LOG_GROUPS.subscriptionEvents}/"`);
		expect(q).toContain(`@logStream like "${LOG_GROUPS.sendTrialFeedbackEmail}/"`);
	});

	it("keeps hutch's checkout events out of the state-changes widget, which is about the Lambda-driven state machine", () => {
		const q = widgetQueries().find(
			(x) => x.includes("subscription_id, reason") && x.includes(`stream = "${STREAMS.subscriptions}"`),
		);
		expect(q).not.toContain(`@logStream like "${LOG_GROUPS.hutchHandler}/"`);
	});

	// The guard that makes the record load-bearing: a Lambda added to LAMBDA_NAMES
	// without an entry fails to compile, and one added with an entry but no log
	// group must not silently leak into a widget about subscription state.
	it("decides every LAMBDA_NAMES entry — an unlisted Lambda cannot reach this widget by default", () => {
		const q = widgetQueries().find(
			(x) => x.includes("subscription_id, reason") && x.includes(`stream = "${STREAMS.subscriptions}"`),
		);
		const named = Object.values(LOG_GROUPS).filter((g) => q?.includes(`@logStream like "${g}/"`));
		expect(named).toHaveLength(Object.keys(LAMBDA_NAMES).length - 1);
	});

	it("both checkout-funnel widgets read the analytics group — checkout events are web-app-emitted subscriptions-stream data now forwarded there", () => {
		const checkoutQueries = widgetQueries().filter((x) =>
			x.includes(SUBSCRIPTION_EVENTS.checkoutStarted),
		);
		expect(checkoutQueries).toHaveLength(2);
		for (const q of checkoutQueries) {
			expect(q.startsWith(`SOURCE '${ANALYTICS_LOG_GROUP}' | `)).toBe(true);
			expect(q).toContain(SUBSCRIPTION_EVENTS.checkoutCompleted);
			expect(q).toContain(SUBSCRIPTION_EVENTS.checkoutReturnFailed);
		}
		const perDay = checkoutQueries.find((q) => q.includes("bin(1d)"));
		expect(perDay).toContain(
			"stats count_distinct(user_id) as users, count(*) as events by bin(1d), event",
		);
		const detail = checkoutQueries.find((q) => q.includes("as detail"));
		expect(detail).toContain(`stats count(*) as n by event, coalesce(variant, reason, "-") as detail`);
	});

	it("the conversions widget splits completed checkouts by paid_now (a $0 trial capture is not revenue) and counts saved-card resubscribes, which never pass through Checkout", () => {
		const q = widgetQueries().find((x) => x.includes(SUBSCRIPTION_EVENTS.resubscribeCompleted));
		expect(q).toBeDefined();
		expect(q?.startsWith(`SOURCE '${ANALYTICS_LOG_GROUP}' | `)).toBe(true);
		expect(q).toContain(SUBSCRIPTION_EVENTS.checkoutCompleted);
		expect(q).toContain("stats count_distinct(user_id) as users by bin(1d), event, paid_now");
		expect(q).not.toContain(SUBSCRIPTION_EVENTS.checkoutStarted);
	});

	it("widget positions do not overlap so every chart is visible side-by-side, not stacked", () => {
		const body = buildBody();
		for (let i = 0; i < body.widgets.length; i++) {
			for (let j = i + 1; j < body.widgets.length; j++) {
				const a = body.widgets[i];
				const b = body.widgets[j];
				const overlapX = a.x < b.x + b.width && b.x < a.x + a.width;
				const overlapY = a.y < b.y + b.height && b.y < a.y + a.height;
				expect({ overlap: overlapX && overlapY, widgets: [a.properties.title, b.properties.title] })
					.toEqual(expect.objectContaining({ overlap: false }));
			}
		}
	});

	it("respects the CloudWatch 24-column grid (no widget exceeds the right edge)", () => {
		const body = buildBody();
		for (const w of body.widgets) {
			expect(w.x + w.width).toBeLessThanOrEqual(24);
		}
	});

	it("LOG_GROUPS is mechanically derived from LAMBDA_NAMES — hand-editing a LOG_GROUPS value out of sync with its LAMBDA_NAMES entry fails CI", () => {
		for (const key of Object.keys(LAMBDA_NAMES) as Array<keyof typeof LAMBDA_NAMES>) {
			expect(LOG_GROUPS[key]).toBe(`/aws/lambda/${LAMBDA_NAMES[key]}-handler`);
		}
		expect(Object.keys(LOG_GROUPS).sort()).toEqual(Object.keys(LAMBDA_NAMES).sort());
	});

	const VISITOR_ID_CLAUSE = `| filter (not ispresent(visitor_id)) or (visitor_id not in ["${EXCLUDED_VISITOR_ID}"]) `;
	const USER_ID_CLAUSE = `| filter (not ispresent(user_id)) or (user_id not in ["${EXCLUDED_USER_ID}"]) `;

	function queriesOf(body: ReturnType<typeof buildBody>): string[] {
		return body.widgets
			.map((w) => w.properties.query)
			.filter((q): q is string => typeof q === "string");
	}

	const CLAUSE_CASES: {
		name: string;
		overrides: Parameters<typeof buildBody>[0];
		stripped: readonly string[];
	}[] = [
		{ name: "both lists configured", overrides: {}, stripped: [] },
		{
			name: "visitor ids only",
			overrides: { excludedUserIds: [] },
			stripped: [USER_ID_CLAUSE],
		},
		{
			name: "user ids only",
			overrides: { excludedVisitorIds: [] },
			stripped: [VISITOR_ID_CLAUSE],
		},
		{
			name: "no list configured",
			overrides: { excludedVisitorIds: [], excludedUserIds: [] },
			stripped: [VISITOR_ID_CLAUSE, USER_ID_CLAUSE],
		},
	];

	it.each(CLAUSE_CASES)(
		"emits each exclusion clause only when its own list is configured, and is otherwise byte-identical ($name)",
		({ overrides, stripped }) => {
			const configured = queriesOf(buildBody());
			const actual = queriesOf(buildBody(overrides));
			expect(actual).toHaveLength(configured.length);
			for (let i = 0; i < actual.length; i++) {
				let expected = configured[i];
				for (const clause of stripped) expected = expected.split(clause).join("");
				expect(actual[i]).toBe(expected);
			}
			for (const clause of stripped) {
				for (const query of actual) expect(query).not.toContain(clause.trim());
			}
		},
	);

	it("prunes the owner by every configured key on exactly the same widgets, so no key can reach a widget the other misses", () => {
		const queries = queriesOf(buildBody());
		const byVisitorId = queries.filter((q) => q.includes("visitor_id not in"));

		expect(byVisitorId.length).toBeGreaterThan(0);
		expect(queries.filter((q) => q.includes("user_id not in"))).toEqual(byVisitorId);
	});

	it("reaches article_read and summary_toggled through the user_id key — both carry a user_id on every row and no visitor_id at all, so the visitor keys cannot prune an internal account from them", () => {
		for (const event of [ANALYTICS_EVENTS.articleRead, ANALYTICS_EVENTS.summaryToggled]) {
			const queries = queriesOf(buildBody()).filter((q) => q.includes(`event = "${event}"`));

			expect(queries.length).toBeGreaterThan(0);
			for (const q of queries) expect(q).toContain(USER_ID_CLAUSE.trim());
		}
	});

	it("guards every exclusion clause with its own not-ispresent half — Logs Insights reads a null field as absent, so a bare not-in would drop the whole anonymous population instead of the owner", () => {
		const emitted = queriesOf(buildBody()).flatMap((q) =>
			[...q.matchAll(/\| filter [^|]*?(?:visitor_id|user_id) not in \[[^\]]*\]\)/g)].map((m) =>
				m[0].trim(),
			),
		);

		expect(emitted.length).toBeGreaterThan(0);
		for (const clause of emitted) {
			const field = /\((\w+) not in \[/.exec(clause)?.[1];
			expect(field).toBeDefined();
			expect(clause).toContain(`(not ispresent(${field})) or`);
		}
	});
});
