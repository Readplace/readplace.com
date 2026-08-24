import assert from "node:assert/strict";
import { NEXT_READ_SNOOZE_MS } from "@packages/domain/article";
import {
	EXPERIMENT_RESULT_STREAM,
	RELATED_PAST_READS_EXPERIMENT,
} from "@packages/hutch-infra-components";
import { NEXT_READ_TRACKING } from "../web/shared/next-read/next-read.tracking";
import { ANALYTICS_EVENTS, ANALYTICS_LOG_GROUP, STREAMS } from "./events";
import type { ExcludedIdentities } from "./excluded-identities";
import { buildRelatedPastReadsDashboardBody } from "./related-past-reads-dashboard";

const EXCLUDED_HASH = "deadbeefcafef00d";
const EXCLUDED_VISITOR_ID = "11111111-1111-4111-8111-111111111111";
const EXCLUDED_USER_ID = "22222222222222222222222222222222";

function buildBody(overrides: Partial<ExcludedIdentities> = {}) {
	return buildRelatedPastReadsDashboardBody({
		region: "ap-southeast-2",
		analyticsLogGroupName: ANALYTICS_LOG_GROUP,
		excludedVisitorHashes: overrides.excludedVisitorHashes ?? [EXCLUDED_HASH],
		excludedVisitorIds: overrides.excludedVisitorIds ?? [EXCLUDED_VISITOR_ID],
		excludedUserIds: overrides.excludedUserIds ?? [EXCLUDED_USER_ID],
	});
}

function engagementQuery(): string {
	const query = logQueries().find((candidate) => candidate.includes(") as engagement"));

	assert(query, "a widget must count engagement by card mode");
	return query;
}

function engagementLabels(): Map<string, string> {
	const branches = /case\((.*)\) as engagement/.exec(engagementQuery());

	assert(branches?.[1], "engagement must be a case() over utm_content");
	const labels = new Map<string, string>();
	for (const [, element, label] of branches[1].matchAll(/utm_content = "([^"]+)", "([^"]+)"/g)) {
		labels.set(element, label);
	}
	return labels;
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

	it("names the card mode a click happened in, so a dismissal is readable without decoding the element", () => {
		const labels = engagementLabels();

		expect(labels.get(NEXT_READ_TRACKING.unread.clickContent)).toBe("Unread pick — opened");
		expect(labels.get(NEXT_READ_TRACKING.unread.dismissContent)).toBe("Unread pick — dismissed");
		expect(labels.get(NEXT_READ_TRACKING.read.clickContent)).toBe("Past read — opened");
		expect(labels.get(NEXT_READ_TRACKING.read.dismissContent)).toBe("Past read — dismissed");
	});

	it("groups engagement by that label rather than by the raw element", () => {
		const query = engagementQuery();

		expect(query).toContain("| stats count(*) as clicks by engagement");
		expect(query).not.toContain("| stats count(*) as clicks by utm_content");
	});

	it("labels every element it lets through the filter, so no click lands in an empty bar", () => {
		const labels = engagementLabels();
		const filtered = /filter utm_content in \[([^\]]+)\]/.exec(engagementQuery());

		assert(filtered?.[1], "the engagement widget must filter to the card's own elements");
		const elements = filtered[1].split(", ").map((quoted) => quoted.slice(1, -1));
		expect(elements.filter((element) => !labels.has(element))).toEqual([]);
		expect(new Set(labels.keys())).toEqual(new Set(elements));
	});

	it("spells out what each dismiss element records, so the two are not read as one event", () => {
		const markdown = String(buildBody().widgets[0]?.properties.markdown);

		assert(
			markdown.includes(`\`${NEXT_READ_TRACKING.unread.dismissContent}\``),
			"the legend must name the unread dismissal",
		);
		assert(
			markdown.includes(`\`${NEXT_READ_TRACKING.read.dismissContent}\``),
			"the legend must name the past-read dismissal",
		);
		expect(markdown).toContain(`returns after ${NEXT_READ_SNOOZE_MS / (60 * 60 * 1000)}h`);
		expect(markdown).toContain("never returns");
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

	it("drops the internal visitor by every configured key on exactly the widgets the rotating IP hash already covers, so the card's own reader counts cannot keep one key and lose another", () => {
		const queries = logQueries();
		const byHash = queries.filter((query) => query.includes(EXCLUDED_HASH));

		expect(byHash.length).toBeGreaterThan(0);
		expect(queries.filter((query) => query.includes(EXCLUDED_VISITOR_ID))).toEqual(byHash);
		expect(queries.filter((query) => query.includes(EXCLUDED_USER_ID))).toEqual(byHash);
	});

	it.each([
		{ name: "no visitor hash", overrides: { excludedVisitorHashes: [] }, absent: "visitor_hash not in" },
		{ name: "no visitor id", overrides: { excludedVisitorIds: [] }, absent: "visitor_id not in" },
		{ name: "no user id", overrides: { excludedUserIds: [] }, absent: "user_id not in" },
	])("emits no exclude clause for a list that is empty ($name)", ({ overrides, absent }) => {
		const queries = buildBody(overrides)
			.widgets.filter((widget) => widget.type === "log")
			.map((widget) => String(widget.properties.query));

		expect(queries.filter((query) => query.includes(absent))).toEqual([]);
	});

	it("guards every exclusion clause with its own not-ispresent half, so an event carrying none of the keys survives", () => {
		const emitted = logQueries().flatMap((query) =>
			[...query.matchAll(/\| filter [^|]*?(?:visitor_hash|visitor_id|user_id) not in \[[^\]]*\]\)/g)].map(
				(match) => match[0].trim(),
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
