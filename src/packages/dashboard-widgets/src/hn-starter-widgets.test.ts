import assert from "node:assert/strict";
import { type ExcludedIdentities, excludeNonAudienceClauses } from "./excluded-identities";
import { hnStarterWidgets } from "./hn-starter-widgets";
import { ANALYTICS_LOG_GROUP } from "./log-groups";

const IDENTITIES: ExcludedIdentities = {
	excludedVisitorIds: ["11111111-1111-4111-8111-111111111111"],
	excludedUserIds: ["22222222222222222222222222222222"],
};

const EXCLUDE = excludeNonAudienceClauses(IDENTITIES).join(" ");
const AUDIENCE_CLAUSES = excludeNonAudienceClauses(IDENTITIES);

const STARTER_REPORT_REASON =
	"Reads the starter_report line the digest-scan tick logs every 6 hours: one aggregate per campaign and cohort, carrying neither visitor_id nor user_id, so there is no identity to prune. Internal accounts never enter it in the first place, because enrollment skips every ENGAGEMENT_EXCLUDED_USER_IDS account before assigning an arm.";

const widgets = hnStarterWidgets({ analyticsLogGroupName: ANALYTICS_LOG_GROUP, identities: IDENTITIES });

describe("hnStarterWidgets", () => {
	it("reads only the analytics group", () => {
		for (const widget of Object.values(widgets)) {
			assert.deepEqual(widget.logGroupNames, [ANALYTICS_LOG_GROUP]);
		}
	});

	it("drops operator accounts, operator visitors and bots from the per-reader widgets", () => {
		for (const widget of [widgets.deliveryOutcomes, widgets.readerActivity, widgets.unsubscribesByArm]) {
			assert.ok(widget.query.includes(EXCLUDE), `${widget.title} must carry the audience exclusions`);
		}
	});

	it("reads the experiment report lines as logged", () => {
		for (const widget of [widgets.latestReport, widgets.latestReportByCohort, widgets.activatedOverTime]) {
			assert.ok(widget.query.includes(`"starter_report"`), `${widget.title} must read the starter report`);
			assert.ok(!widget.query.includes(EXCLUDE), `${widget.title} must not carry the audience exclusions`);
		}
	});

	it("names each unfiltered report widget with the reason it carries no audience clause, and leaves every clause on the others", () => {
		const unfiltered = [
			{ widget: widgets.latestReport, title: "Hacker News starter — latest experiment report (logged every 6 hours)", reason: STARTER_REPORT_REASON },
			{ widget: widgets.latestReportByCohort, title: "Hacker News starter — latest report by tier and account cohort", reason: STARTER_REPORT_REASON },
			{ widget: widgets.activatedOverTime, title: "Hacker News starter — activated and mature accounts by arm over time", reason: STARTER_REPORT_REASON },
		];
		const named = new Set(unfiltered.map(({ title }) => title));

		for (const { widget, title, reason } of unfiltered) {
			assert.equal(widget.title, title, reason);
			assert.ok(!AUDIENCE_CLAUSES.some((clause) => widget.query.includes(clause)), `${title}: ${reason}`);
		}
		const filterable = Object.values(widgets).filter(({ title }) => !named.has(title));
		assert.equal(filterable.length, 3);
		for (const widget of filterable) {
			assert.ok(AUDIENCE_CLAUSES.every((clause) => widget.query.includes(clause)), `${widget.title} must carry every audience clause`);
		}
	});

	it("splits the activity widget by whether the activity acted on a suggestion", () => {
		assert.ok(
			widgets.readerActivity.query.includes(
				"| stats count(*) as actions, count_distinct(user_id) as accounts by campaign_id, arm, activity_kind, marked_read, on_suggestion",
			),
		);
	});

	it("reads the latest whole-experiment report and keeps cohorts on their own widget", () => {
		const reportQueries = Object.values(widgets)
			.map(({ query }) => query)
			.filter((query) => query.includes(`event = "starter_report"`));

		assert.equal(reportQueries.length, 3);
		assert.equal(reportQueries.filter((query) => query.includes(`cohort = "all"`)).length, 2);
		assert.equal(reportQueries.filter((query) => query.includes(`cohort != "all"`)).length, 1);
		assert.ok(widgets.latestReport.query.includes("latest(conclusion) as verdict"));
		assert.ok(widgets.activatedOverTime.query.includes("by bin(6h)"));
	});
});
