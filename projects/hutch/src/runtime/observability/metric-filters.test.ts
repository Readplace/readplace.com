import { ANALYTICS_EVENTS, CONVERSION_EVENTS, METRICS, STREAMS } from "./events";
import {
	ANALYTICS_METRIC_FILTERS,
	ANALYTICS_METRIC_NAMESPACE,
	analyticsMetricFilterPattern,
} from "./metric-filters";

describe("analytics metric filters", () => {
	it("selects a forwarded line by stream and event with a JSON selector, the shape aws logs test-metric-filter matched against a real /readplace/analytics line — the destination group carries the bare payload, so $.field resolves there", () => {
		expect(analyticsMetricFilterPattern(ANALYTICS_METRIC_FILTERS.viewSaveIntent)).toBe(
			`{ $.stream = "${STREAMS.analytics}" && $.event = "${ANALYTICS_EVENTS.viewSaveIntent}" }`,
		);
	});

	it("meters the events an investigation wants beyond the log group's floor, pinned rather than merely typed: dropping one silently ends that event's 15-month history", () => {
		const events = Object.values(ANALYTICS_METRIC_FILTERS).map((filter) => filter.event);
		expect(events.sort()).toEqual(
			[
				ANALYTICS_EVENTS.pageview,
				ANALYTICS_EVENTS.viewSaveIntent,
				CONVERSION_EVENTS.userCreated,
			].sort(),
		);
	});

	it("names only declared streams, so a hand-edited raw string cannot reach a deployed filter and match nothing", () => {
		const declared = new Set<string>(Object.values(STREAMS));
		for (const filter of Object.values(ANALYTICS_METRIC_FILTERS)) {
			expect(declared.has(filter.stream)).toBe(true);
		}
	});

	it("gives every event its own metric name, since a duplicate would merge two events into one series that no later reader could unmix", () => {
		const names = Object.values(ANALYTICS_METRIC_FILTERS).map((filter) => filter.metricName);
		expect(new Set(names).size).toBe(names.length);
	});

	it("publishes into a namespace of its own rather than the imports namespace, so the existing lifetime import series stays a single-purpose metric", () => {
		expect(ANALYTICS_METRIC_NAMESPACE).toBe("Readplace/Analytics");
		expect(ANALYTICS_METRIC_NAMESPACE).not.toBe(METRICS.importsCompleted.namespace);
	});

	it("dates every counter and says on its face that it includes internal traffic: the exclusion list is expressible as a metric-filter pattern and is left off by choice, and a series whose first datapoint is the day its filter was created is not a lifetime", () => {
		for (const filter of Object.values(ANALYTICS_METRIC_FILTERS)) {
			expect(filter.widgetTitle).toMatch(
				/ \(CloudWatch metric since \d{4}-\d{2}-\d{2}, internal traffic included\)$/,
			);
		}
	});

	it("emits no dimensions, so a filter cannot start billing one custom metric per distinct path or host", () => {
		const fields = new Set(Object.values(ANALYTICS_METRIC_FILTERS).flatMap(Object.keys));
		expect([...fields].sort()).toEqual(["event", "metricName", "stream", "widgetTitle"]);
	});
});
