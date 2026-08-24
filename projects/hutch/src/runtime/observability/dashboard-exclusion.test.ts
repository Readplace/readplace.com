import assert from "node:assert/strict";
import {
	buildAnalyticsDashboardBody,
	type DashboardBody,
	type DashboardWidget,
} from "./analytics-dashboard";
import { ANALYTICS_LOG_GROUP, ERRORS_LOG_GROUP, LOG_GROUPS } from "./events";
import { type ExcludedIdentities, excludeInternalVisitorsClauses } from "./excluded-identities";
import { buildRelatedPastReadsDashboardBody } from "./related-past-reads-dashboard";

const IDENTITIES: ExcludedIdentities = {
	excludedVisitorIds: ["11111111-1111-4111-8111-111111111111"],
	excludedUserIds: ["22222222222222222222222222222222"],
};

const IDENTITY_CLAUSES = excludeInternalVisitorsClauses(IDENTITIES);

const AUDIENCE_DATA_PROPERTY = { log: "query", metric: "metrics" } as const;
const STATIC_DATA_PROPERTY = { text: "markdown" } as const;
const DATA_PROPERTY_BY_TYPE = { ...AUDIENCE_DATA_PROPERTY, ...STATIC_DATA_PROPERTY };
const AUDIENCE_DATA_TYPES: readonly string[] = Object.keys(AUDIENCE_DATA_PROPERTY);
const DATA_PROPERTIES: readonly string[] = Object.values(DATA_PROPERTY_BY_TYPE);

interface UnfilteredWidget {
	title: string;
	reason: string;
}

const OFFLINE_HARNESS_REASON =
	"Offline prompt-arm harness output. An arm-result line describes one model run against a stored anchor, not a person, so ExperimentArmResultEvent carries neither visitor_id nor user_id for a clause to match.";

const METRIC_COUNTER_REASON =
	"Renders a CloudWatch metric filled by a LogMetricFilter, which matches a line at ingest and increments a counter. The exclusion is expressible in that pattern language, and it fits: factored as ($.visitor_id NOT EXISTS || ($.visitor_id != \"…\" && …)), today's 9 visitor and 7 user ids come to 988 of the 1,024 characters CloudWatch allows, and aws logs test-metric-filter confirms that pattern drops an internal visitor while keeping both an ordinary visitor and a line carrying no visitor_id. It is left off by choice rather than by that ceiling. A filter pattern applies at ingest and never retroactively, so each identity added would silently redefine what the series had been counting, turning a config edit into a step change nobody could distinguish from real traffic — and the list has grown three times in recent work, with no room for another id of either kind before the pattern crosses 1,024 regardless. A constant, disclosed overcount beats a series whose definition moves.";

const ANALYTICS_UNFILTERED_WIDGETS: readonly UnfilteredWidget[] = [
	{
		title: "Recent errors (logError + parse-errors, whole fleet)",
		reason:
			"Reads the errors funnel, not the analytics group. Membership of that group is already the filter, and an internal account's stack trace must stay visible: this is an operational fleet view, not an audience count.",
	},
	{
		title: "Imports completed (lifetime)",
		reason:
			"Renders a CloudWatch metric, and a datapoint has no field a Logs Insights clause could filter on. The import_committed event feeding the metric filter carries neither visitor_id nor user_id either, so there is no identity anywhere in that chain to prune — the counter includes internal imports and no dashboard-layer change can alter that.",
	},
	{
		title: "Pageviews (lifetime metric, internal traffic included)",
		reason: `${METRIC_COUNTER_REASON} Measured over the life of /readplace/analytics, the exclusion list removes 20.1% of pageview lines (12,119 of 60,208), so this counter reads about a quarter above the Logs Insights pageview widgets beside it — which is why the title says so on the widget's face.`,
	},
	{
		title: "Save intents (lifetime metric, internal traffic included)",
		reason: `${METRIC_COUNTER_REASON} Measured over the same window, the exclusion list removes 8.1% of view_save_intent lines (374 of 4,593).`,
	},
	{
		title: "Signups (lifetime metric, internal traffic included)",
		reason: `${METRIC_COUNTER_REASON} No excluded identity has produced a user_created line so far (0 of 24), but that is an accident of who has signed up, not a property of the counter — an internal signup would land in it.`,
	},
];

const RELATED_PAST_READS_UNFILTERED_WIDGETS: readonly UnfilteredWidget[] = [
	{ title: "Experiment — picks per arm (unread vs past read)", reason: OFFLINE_HARNESS_REASON },
	{ title: "Experiment — cost and latency per arm", reason: OFFLINE_HARNESS_REASON },
	{ title: "Experiment — picks per arm over successive runs", reason: OFFLINE_HARNESS_REASON },
	{ title: "Experiment — every arm result (newest first)", reason: OFFLINE_HARNESS_REASON },
];

const DASHBOARDS: {
	name: string;
	body: DashboardBody;
	unfiltered: readonly UnfilteredWidget[];
}[] = [
	{
		name: "readplace-analytics",
		body: buildAnalyticsDashboardBody({
			...IDENTITIES,
			region: "ap-southeast-2",
			hutchLogGroupName: LOG_GROUPS.hutchHandler,
			analyticsLogGroupName: ANALYTICS_LOG_GROUP,
			errorsLogGroupName: ERRORS_LOG_GROUP,
		}),
		unfiltered: ANALYTICS_UNFILTERED_WIDGETS,
	},
	{
		name: "readplace-related-past-reads",
		body: buildRelatedPastReadsDashboardBody({
			...IDENTITIES,
			region: "ap-southeast-2",
			analyticsLogGroupName: ANALYTICS_LOG_GROUP,
		}),
		unfiltered: RELATED_PAST_READS_UNFILTERED_WIDGETS,
	},
];

function titleOf(widget: DashboardWidget): string {
	const title = widget.properties.title;
	assert(typeof title === "string", "a widget that shows audience data must carry a title");
	return title;
}

function queryOf(widget: DashboardWidget): string {
	const query = widget.properties.query;
	return typeof query === "string" ? query : "";
}

function audienceWidgets(body: DashboardBody): DashboardWidget[] {
	return body.widgets.filter((widget) => AUDIENCE_DATA_TYPES.includes(widget.type));
}

describe.each(DASHBOARDS)("$name — internal identities", ({ body, unfiltered }) => {
	const named = new Set(unfiltered.map((widget) => widget.title));

	it("prunes the internal visitor and the internal user from every widget that shows audience data and is not a named exception, so a widget added without the clause fails here instead of quietly reporting internal traffic as customer traffic", () => {
		const filterable = audienceWidgets(body).filter((widget) => !named.has(titleOf(widget)));
		const missing = filterable
			.filter((widget) => !IDENTITY_CLAUSES.every((clause) => queryOf(widget).includes(clause)))
			.map(titleOf);

		expect(IDENTITY_CLAUSES.length).toBeGreaterThan(0);
		expect(filterable.length).toBeGreaterThan(0);
		expect(missing).toEqual([]);
	});

	it("names an exception that the builder still emits, so a renamed or deleted widget cannot leave a stale entry behind that would exempt a future widget sharing its title", () => {
		const emitted = new Set(audienceWidgets(body).map(titleOf));

		expect([...named].filter((title) => !emitted.has(title))).toEqual([]);
	});

	it("leaves every named exception genuinely unfiltered, so the list records a decision instead of describing a widget that already carries the clause", () => {
		const contradicted = audienceWidgets(body)
			.filter((widget) => named.has(titleOf(widget)))
			.filter((widget) => IDENTITY_CLAUSES.some((clause) => queryOf(widget).includes(clause)))
			.map(titleOf);

		expect(contradicted).toEqual([]);
	});

	it("gives every widget exactly the one data property its type implies, so a metric widget cannot hide behind a log widget's exemption and a widget type nobody has classified fails rather than escaping the rule", () => {
		for (const widget of body.widgets) {
			const classified = Object.entries(DATA_PROPERTY_BY_TYPE).find(
				([widgetType]) => widgetType === widget.type,
			);
			assert(
				classified,
				`widget type "${widget.type}" is classified as neither audience nor static data`,
			);

			const [, owned] = classified;
			const carried = DATA_PROPERTIES.filter(
				(property) => widget.properties[property] !== undefined,
			);

			expect(carried).toEqual([owned]);
		}
	});
});
