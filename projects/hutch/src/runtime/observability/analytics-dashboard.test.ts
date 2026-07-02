import { SAVE_LINK_LOG_GROUPS } from "@packages/hutch-infra-components";
import {
	ANALYTICS_EVENTS,
	CONVERSION_EVENTS,
	LAMBDA_NAMES,
	LOG_GROUPS,
	METRICS,
	STREAMS,
	SUBSCRIPTION_EVENTS,
} from "./events";
import {
	buildAnalyticsDashboardBody,
	SUBSCRIPTION_DASHBOARD_LOG_GROUPS,
	WORKER_DASHBOARD_LOG_GROUPS,
} from "./analytics-dashboard";

const ANY_STREAM_RE = /\bstream\s*=\s*"([a-z][a-z0-9_-]*)"/g;
const ANY_EVENT_RE = /\bevent\s*=\s*"([a-z][a-z0-9_]*)"/g;
const EVENT_IN_LIST_RE = /\bevent\s+in\s+\[([^\]]+)\]/g;

function buildBody() {
	return buildAnalyticsDashboardBody({
		region: "ap-southeast-2",
		hutchLogGroupName: LOG_GROUPS.hutchHandler,
		subscriptionLogGroupNames: SUBSCRIPTION_DASHBOARD_LOG_GROUPS,
		workerLogGroupNames: WORKER_DASHBOARD_LOG_GROUPS,
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
	it("emits 24 widgets (7 traffic+audience, 3 conversions, 3 imports+medium, 3 subscriptions, 2 view-funnel, 1 internal-clicks, 3 save-funnel, 1 summary-engagement, 1 errors) — adding or dropping one without updating this count is a deliberate signal to review the dashboard's scope", () => {
		const body = buildBody();
		expect(body.widgets).toHaveLength(24);
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
		const expectedSource = [
			LOG_GROUPS.hutchHandler,
			...SUBSCRIPTION_DASHBOARD_LOG_GROUPS,
			...WORKER_DASHBOARD_LOG_GROUPS,
		]
			.map((name) => `SOURCE '${name}'`)
			.join(" | ");
		expect(query).toContain(`${expectedSource} | fields @timestamp, level`);
	});

	it("every async-worker log group (SAVE_LINK_LOG_GROUPS) is surfaced by the errors widget — adding a worker Lambda to the shared constant without it flowing onto the dashboard fails CI", () => {
		const errorWidget = buildBody().widgets.find(
			(w) => typeof w.properties.query === "string" && w.properties.query.includes("coalesce(message, reason) as detail"),
		);
		const query = errorWidget?.properties.query;
		const workerLogGroups = Object.values(SAVE_LINK_LOG_GROUPS);
		expect(workerLogGroups.length).toBeGreaterThan(0);
		for (const logGroup of workerLogGroups) {
			expect(query).toContain(`SOURCE '${logGroup}'`);
		}
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

	it("queries spanning subscription Lambda log groups emit one `SOURCE '<name>'` per group joined by `|` — `logGroups(namePrefix: [...])` is a CLI-only form the dashboard renderer rejects", () => {
		const subscriptionQueries = widgetQueries().filter((q) => q.includes(`"${STREAMS.subscriptions}"`));
		const expectedSourcePrefix = `${SUBSCRIPTION_DASHBOARD_LOG_GROUPS.map((name) => `SOURCE '${name}'`).join(" | ")} | `;
		for (const q of subscriptionQueries) {
			expect(q.startsWith(expectedSourcePrefix)).toBe(true);
		}
		expect(subscriptionQueries.length).toBeGreaterThan(0);
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

	it("every LOG_GROUPS value is wired into the dashboard builder as hutchLogGroupName or via SUBSCRIPTION_DASHBOARD_LOG_GROUPS — adding a log group without a dashboard reference fails CI", () => {
		const wired = new Set<string>([
			LOG_GROUPS.hutchHandler,
			...SUBSCRIPTION_DASHBOARD_LOG_GROUPS,
		]);
		const declared = Object.values(LOG_GROUPS);
		const unwired = declared.filter((name) => !wired.has(name));
		expect(unwired).toEqual([]);
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
			subscriptionLogGroupNames: SUBSCRIPTION_DASHBOARD_LOG_GROUPS,
			workerLogGroupNames: WORKER_DASHBOARD_LOG_GROUPS,
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
