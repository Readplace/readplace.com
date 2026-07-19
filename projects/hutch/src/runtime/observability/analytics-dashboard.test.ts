import {
	BLOG_SITE_LOG_GROUP,
	FORWARD_ANALYTICS_FUNCTION_NAME,
	SAVE_LINK_LOG_GROUPS,
} from "@packages/hutch-infra-components";
import { HOMEPAGE_SPLIT } from "../web/experiments/homepage-split";
import {
	ANALYTICS_EVENTS,
	ANALYTICS_LOG_GROUP,
	CONVERSION_EVENTS,
	ERRORS_LOG_GROUP,
	LAMBDA_NAMES,
	LOG_GROUPS,
	METRICS,
	STREAMS,
	SUBSCRIPTION_EVENTS,
} from "./events";
import {
	buildAnalyticsDashboardBody,
	FORWARDED_SOURCE_LOG_GROUPS,
} from "./analytics-dashboard";

const ANY_STREAM_RE = /\bstream\s*=\s*"([a-z][a-z0-9_-]*)"/g;
const ANY_EVENT_RE = /\bevent\s*=\s*"([a-z][a-z0-9_]*)"/g;
const EVENT_IN_LIST_RE = /\bevent\s+in\s+\[([^\]]+)\]/g;

function buildBody() {
	return buildAnalyticsDashboardBody({
		region: "ap-southeast-2",
		hutchLogGroupName: LOG_GROUPS.hutchHandler,
		analyticsLogGroupName: ANALYTICS_LOG_GROUP,
		errorsLogGroupName: ERRORS_LOG_GROUP,
		excludedVisitorHashes: ["deadbeefcafef00d"],
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
	it("emits 35 widgets (7 traffic+audience, 3 conversions, 3 imports+medium, 3 subscriptions, 2 view-funnel, 1 internal-clicks, 4 save-funnel, 1 summary-engagement, 2 audience-device, 1 errors, 1 homepage-ab, 1 blog-traffic, 2 signup-form, 2 checkout-funnel, 1 paid-conversions, 1 first-article-autosave) — adding or dropping one without updating this count is a deliberate signal to review the dashboard's scope", () => {
		const body = buildBody();
		expect(body.widgets).toHaveLength(35);
	});

	it("the first-article-autosave widget counts the discrete first_article_autosaved event per day — a 1:1 activation signal independent of the utm_source marker — excluding internal visitors, whose single test signup would skew a day at this event's volume", () => {
		const queries = widgetQueries();
		const autosave = queries.find((q) => q.includes(`event = "${ANALYTICS_EVENTS.firstArticleAutosaved}"`));
		expect(autosave).toBeDefined();
		expect(autosave?.startsWith(`SOURCE '${ANALYTICS_LOG_GROUP}' | `)).toBe(true);
		expect(autosave).toContain(`stream = "${STREAMS.analytics}"`);
		expect(autosave).toContain("visitor_hash not in");
		expect(autosave).toContain("stats count(*) as autosaves by bin(1d)");
	});

	it("the homepage A/B widget compares arms by distinct visitors (assignment is sticky per browser, so raw counts pile a returning visitor's landings onto one arm) with raw landings alongside, grouped by variant (utm_content)", () => {
		const queries = widgetQueries();
		const ab = queries.find((q) => q.includes(`utm_campaign = "${HOMEPAGE_SPLIT.campaign}"`));
		expect(ab).toBeDefined();
		expect(ab).toContain(`event = "${ANALYTICS_EVENTS.pageview}"`);
		expect(ab).toContain("stats count_distinct(visitor_hash) as visitors, count(*) as landings by utm_content");
		expect(ab).toContain("| sort visitors desc");
		expect(ab).not.toContain("| filter ispresent(visitor_hash)");
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

	it("the opens widget counts distinct authenticated visitors on the reader view path /<id>/view — funnel companion to the readers widget", () => {
		const queries = widgetQueries();
		const opens = queries.find((q) => q.includes("reader_opens"));
		expect(opens).toBeDefined();
		expect(opens).toContain(`event = "${ANALYTICS_EVENTS.pageview}"`);
		expect(opens).toContain("\\/view$");
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

	it("the errors widget is a latest-first table that surfaces logError lines and the parse-errors stream across the hutch, every subscription, and every async-worker log group", () => {
		const errorWidget = buildBody().widgets.find(
			(w) => typeof w.properties.query === "string" && w.properties.query.includes("coalesce(message, reason) as detail"),
		);
		expect(errorWidget).toBeDefined();
		expect(errorWidget?.properties.view).toBe("table");
		const query = errorWidget?.properties.query;
		expect(query).toContain('filter level = "ERROR"');
		expect(query).toContain(`stream = "${STREAMS.parseErrors}"`);
		expect(query).toContain('@message like "ERROR"');
		expect(query).toContain("| sort @timestamp desc");
		expect(query).toContain("| limit 100");
		expect(query).toContain(`SOURCE '${ERRORS_LOG_GROUP}' | fields @timestamp, level`);
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
		// Streams whose data is only inspected via ad-hoc Log Insights queries,
		// not surfaced on the analytics dashboard. The parse-errors stream is
		// surfaced by the Recent-errors widget, so only crawl-outcomes remains;
		// adding a crawl-outcome widget would empty this set.
		const ignored = new Set<string>([
			STREAMS.crawlOutcomes,
		]);
		expect(ignored.size).toBe(1);
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

	it("references the Readplace/Imports metric so the singleValue widget is wired to the LogMetricFilter", () => {
		const body = buildBody();
		const metricWidget = body.widgets.find((w) => w.type === "metric");
		expect(metricWidget).toBeDefined();
		const metrics = metricWidget?.properties.metrics;
		expect(metrics).toEqual([
			[METRICS.importsCompleted.namespace, METRICS.importsCompleted.name, { stat: "Sum" }],
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

	it("the subscription state-changes widget excludes hutch-origin checkout events so it keeps its Lambda-only semantics after the merge", () => {
		const q = widgetQueries().find(
			(x) => x.includes("subscription_id, reason") && x.includes(`stream = "${STREAMS.subscriptions}"`),
		);
		expect(q).toBeDefined();
		expect(q?.startsWith(`SOURCE '${ANALYTICS_LOG_GROUP}' | `)).toBe(true);
		expect(q).toContain(`| filter @logStream not like "${LOG_GROUPS.hutchHandler}/"`);
	});

	it("FORWARDED_SOURCE_LOG_GROUPS covers hutch, blog, and every subscription group and excludes the analytics destination and the forwarder's own group so the forwarder never subscribes to its own output", () => {
		const forwarded = new Set(FORWARDED_SOURCE_LOG_GROUPS);
		for (const expected of [LOG_GROUPS.hutchHandler, BLOG_SITE_LOG_GROUP, ...Object.values(LOG_GROUPS)]) {
			expect(forwarded.has(expected)).toBe(true);
		}
		expect(forwarded.has(ANALYTICS_LOG_GROUP)).toBe(false);
		expect(forwarded.has(`/aws/lambda/${FORWARD_ANALYTICS_FUNCTION_NAME}`)).toBe(false);
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

	// Replaces a test asserting every LOG_GROUPS value appeared in the dashboard.
	// It cannot survive the funnel: the dashboard now references no project group
	// at all, on purpose. What matters instead is that every declared group is
	// forwarded, which is what puts its errors on the dashboard.
	it("every LOG_GROUPS value is a forwarded source — a log group that reaches no funnel is invisible to the dashboard", () => {
		const forwarded = new Set(FORWARDED_SOURCE_LOG_GROUPS);
		const unforwarded = Object.values(LOG_GROUPS).filter((name) => !forwarded.has(name));
		expect(unforwarded).toEqual([]);
	});

	it("LOG_GROUPS is mechanically derived from LAMBDA_NAMES — hand-editing a LOG_GROUPS value out of sync with its LAMBDA_NAMES entry fails CI", () => {
		for (const key of Object.keys(LAMBDA_NAMES) as Array<keyof typeof LAMBDA_NAMES>) {
			expect(LOG_GROUPS[key]).toBe(`/aws/lambda/${LAMBDA_NAMES[key]}-handler`);
		}
		expect(Object.keys(LOG_GROUPS).sort()).toEqual(Object.keys(LAMBDA_NAMES).sort());
	});

	it("omits the visitor_hash exclusion clause from every widget query when no hashes are configured — each query equals the configured-hash query with the exclusion clause stripped", () => {
		const excludeClause = `| filter (not ispresent(visitor_hash)) or (visitor_hash not in ["deadbeefcafef00d"]) `;
		const withExclusion = buildBody();
		const withoutExclusion = buildAnalyticsDashboardBody({
			region: "ap-southeast-2",
			hutchLogGroupName: LOG_GROUPS.hutchHandler,
			analyticsLogGroupName: ANALYTICS_LOG_GROUP,
			errorsLogGroupName: ERRORS_LOG_GROUP,
			excludedVisitorHashes: [],
		});
		expect(withoutExclusion.widgets).toHaveLength(withExclusion.widgets.length);
		for (let i = 0; i < withoutExclusion.widgets.length; i++) {
			const configured = withExclusion.widgets[i].properties.query;
			const omitted = withoutExclusion.widgets[i].properties.query;
			if (typeof configured !== "string" || typeof omitted !== "string") continue;
			expect(omitted).toBe(configured.split(excludeClause).join(""));
		}
	});
});
