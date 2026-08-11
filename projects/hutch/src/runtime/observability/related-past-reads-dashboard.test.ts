import assert from "node:assert/strict";
import {
	EXPERIMENT_RESULT_STREAM,
	RELATED_PAST_READS_EXPERIMENT,
} from "@packages/hutch-infra-components";
import { NEXT_READ_TRACKING } from "../web/shared/next-read/next-read.tracking";
import { ANALYTICS_EVENTS, ANALYTICS_LOG_GROUP, STREAMS } from "./events";
import { buildRelatedPastReadsDashboardBody } from "./related-past-reads-dashboard";

const EXCLUDED_HASH = "deadbeefcafef00d";

function buildBody(excludedVisitorHashes: readonly string[] = [EXCLUDED_HASH]) {
	return buildRelatedPastReadsDashboardBody({
		region: "ap-southeast-2",
		analyticsLogGroupName: ANALYTICS_LOG_GROUP,
		excludedVisitorHashes,
	});
}

function logQueries(): string[] {
	return buildBody()
		.widgets.filter((widget) => widget.type === "log")
		.map((widget) => widget.properties.query)
		.filter((query): query is string => typeof query === "string");
}

describe("buildRelatedPastReadsDashboardBody", () => {
	it("reads every log widget from the never-expire analytics group", () => {
		const sources = logQueries().map((query) => query.split(" | ")[0]);

		expect(new Set(sources)).toEqual(new Set([`SOURCE '${ANALYTICS_LOG_GROUP}'`]));
	});

	it("separates the two card modes by the element the card actually stamps", () => {
		const clicks = logQueries().filter((query) =>
			query.includes(NEXT_READ_TRACKING.read.clickContent),
		);

		assert(clicks.length > 0, "the shipped-feature widgets must query the past-read element");
		const unreadOnly = logQueries().filter(
			(query) =>
				query.includes(`"${NEXT_READ_TRACKING.unread.clickContent}"`) &&
				!query.includes(NEXT_READ_TRACKING.read.clickContent),
		);
		expect(unreadOnly).toEqual([]);
	});

	it("counts a dismissal separately from an open, for both modes", () => {
		const engagement = logQueries().find((query) =>
			query.includes(NEXT_READ_TRACKING.read.dismissContent),
		);

		assert(engagement, "a widget must plot dismissals");
		for (const element of [
			NEXT_READ_TRACKING.unread.clickContent,
			NEXT_READ_TRACKING.read.clickContent,
			NEXT_READ_TRACKING.unread.dismissContent,
			NEXT_READ_TRACKING.read.dismissContent,
		]) {
			assert(engagement.includes(`"${element}"`), `${element} must be plotted`);
		}
	});

	it("reads the shipped feature off the click event the analytics middleware already emits", () => {
		const shipped = logQueries().filter((query) =>
			query.includes(`event = "${ANALYTICS_EVENTS.click}"`),
		);

		expect(shipped.length).toBeGreaterThan(0);
		for (const query of shipped) {
			assert(
				query.includes(`stream = "${STREAMS.analytics}"`),
				"a click widget must scope itself to the analytics stream",
			);
		}
	});

	it("scopes every experiment widget to this experiment, so another one cannot bleed in", () => {
		const experiment = logQueries().filter((query) =>
			query.includes(`stream = "${EXPERIMENT_RESULT_STREAM}"`),
		);

		expect(experiment.length).toBeGreaterThan(0);
		for (const query of experiment) {
			assert(
				query.includes(`experiment = "${RELATED_PAST_READS_EXPERIMENT}"`),
				"an experiment widget must name the experiment it plots",
			);
		}
	});

	it("compares every arm against the others rather than plotting one", () => {
		const perArm = logQueries().filter(
			(query) => query.includes(`stream = "${EXPERIMENT_RESULT_STREAM}"`) && query.includes(" by arm"),
		);

		expect(perArm.length).toBeGreaterThan(0);
	});

	it("drops the internal visitor from the shipped-feature widgets", () => {
		const excluded = logQueries().filter((query) => query.includes(EXCLUDED_HASH));

		expect(excluded.length).toBeGreaterThan(0);
	});

	it("keeps every widget inside the 24-column grid without overlapping", () => {
		const widgets = buildBody().widgets;
		const occupied = new Set<string>();

		for (const widget of widgets) {
			expect(widget.x + widget.width).toBeLessThanOrEqual(24);
			for (let x = widget.x; x < widget.x + widget.width; x += 1) {
				for (let y = widget.y; y < widget.y + widget.height; y += 1) {
					const cell = `${x},${y}`;
					assert(!occupied.has(cell), `widgets overlap at ${cell}`);
					occupied.add(cell);
				}
			}
		}
	});

	it("leads with a text widget naming what success means", () => {
		const first = buildBody().widgets[0];

		assert(first, "the dashboard must render at least one widget");
		expect(first.type).toBe("text");
		expect(String(first.properties.markdown)).toContain("Similar past reads");
	});

	it("emits no exclude clause when no visitor is excluded", () => {
		const queries = buildBody([])
			.widgets.filter((widget) => widget.type === "log")
			.map((widget) => String(widget.properties.query));

		expect(queries.filter((query) => query.includes("visitor_hash not in"))).toEqual([]);
	});
});
