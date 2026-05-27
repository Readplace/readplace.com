import {
	ANALYTICS_EVENTS,
	CONVERSION_EVENTS,
	LOG_GROUPS,
	METRICS,
	STREAMS,
	SUBSCRIPTION_EVENTS,
} from "./events";
import {
	buildAnalyticsDashboardBody,
	SUBSCRIPTION_DASHBOARD_LOG_GROUPS,
} from "./analytics-dashboard";

const ANY_STREAM_RE = /\bstream\s*=\s*"([a-z][a-z0-9_-]*)"/g;
const ANY_EVENT_RE = /\bevent\s*=\s*"([a-z][a-z0-9_]*)"/g;
const EVENT_IN_LIST_RE = /\bevent\s+in\s+\[([^\]]+)\]/g;

function buildBody() {
	return buildAnalyticsDashboardBody({
		region: "ap-southeast-2",
		hutchLogGroupName: LOG_GROUPS.hutchHandler,
		subscriptionLogGroupNames: SUBSCRIPTION_DASHBOARD_LOG_GROUPS,
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
	it("emits 14 widgets (5 traffic+audience, 3 conversions, 3 imports+medium, 3 subscriptions) — adding or dropping one without updating this count is a deliberate signal to review the dashboard's scope", () => {
		const body = buildBody();
		expect(body.widgets).toHaveLength(14);
	});

	it("every stream used by an emitter (STREAMS) is referenced by at least one widget query — adding a new stream without a widget fails CI", () => {
		const referenced = collectReferencedStreams();
		const declared = new Set(Object.values(STREAMS));
		// Streams whose data is only inspected via ad-hoc Log Insights queries,
		// not surfaced on the analytics dashboard. Updating the dashboard to
		// include parse-error / crawl-outcome widgets would shrink this set.
		const ignored = new Set<string>([
			STREAMS.parseErrors,
			STREAMS.crawlOutcomes,
		]);
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

	it("queries spanning subscription Lambda log groups use the multi-log-group SOURCE clause — comma-separated quoted names confuse CloudWatch with 'cannot contain a comma'", () => {
		const subscriptionQueries = widgetQueries().filter((q) => q.includes(`"${STREAMS.subscriptions}"`));
		for (const q of subscriptionQueries) {
			expect(q).toMatch(/^SOURCE logGroups\(namePrefix: \[/);
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

	it("omits the visitor_hash exclusion clause from every widget query when no hashes are configured", () => {
		const body = buildAnalyticsDashboardBody({
			region: "ap-southeast-2",
			hutchLogGroupName: LOG_GROUPS.hutchHandler,
			subscriptionLogGroupNames: SUBSCRIPTION_DASHBOARD_LOG_GROUPS,
			excludedVisitorHashes: [],
		});
		for (const w of body.widgets) {
			const q = w.properties.query;
			if (typeof q !== "string") continue;
			expect(q).not.toContain("visitor_hash not in");
		}
	});
});
