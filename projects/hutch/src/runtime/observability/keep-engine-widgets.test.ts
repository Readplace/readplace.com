import assert from "node:assert/strict";
import { ANALYTICS_LOG_GROUP } from "./events";
import { type ExcludedIdentities, excludeNonAudienceClauses } from "./excluded-identities";
import { keepEngineWidgets } from "./keep-engine-widgets";

const IDENTITIES: ExcludedIdentities = {
	excludedVisitorIds: ["11111111-1111-4111-8111-111111111111"],
	excludedUserIds: ["22222222222222222222222222222222"],
};

const EXCLUDE = excludeNonAudienceClauses(IDENTITIES).join(" ");

const widgets = keepEngineWidgets({ analyticsLogGroupName: ANALYTICS_LOG_GROUP, identities: IDENTITIES });

describe("keepEngineWidgets", () => {
	it("reads only the analytics group, as tables, and drops operator accounts, operator visitors and bots from every query", () => {
		for (const widget of Object.values(widgets)) {
			assert.deepEqual(widget.logGroupNames, [ANALYTICS_LOG_GROUP]);
			assert.equal(widget.view, "table");
			assert.ok(widget.query.includes(EXCLUDE), `${widget.title} must carry the audience exclusions`);
		}
	});

	it("counts distinct trial signups by client, naming a signup with no OAuth client as web", () => {
		assert.equal(
			widgets.trialsByClient.query,
			`fields @timestamp, user_id, coalesce(oauth_client_id, "web") as client, method | filter stream = "conversions" and event = "user_created" and tier = "trial" ${EXCLUDE} | stats count_distinct(user_id) as trials by client`,
		);
	});

	it("puts threshold crossings beside keep-panel shows and clicks, by surface", () => {
		assert.equal(
			widgets.panelReach.query,
			`fields @timestamp, event, user_id, coalesce(surface, "-") as panel_surface | filter event in ["activation_threshold_reached", "keep_offer_shown", "keep_offer_clicked"] ${EXCLUDE} | stats count(*) as events, count_distinct(user_id) as users by event, panel_surface`,
		);
	});

	it("counts lifecycle email sends and recipients by kind", () => {
		assert.equal(
			widgets.lifecycleSends.query,
			`fields @timestamp, user_id, kind, trial_day | filter event = "lifecycle_email_sent" ${EXCLUDE} | stats count(*) as sends, count_distinct(user_id) as recipients by kind`,
		);
	});

	it("counts signed-in email clicks and clickers by source and campaign, most clickers first", () => {
		assert.equal(
			widgets.emailClicks.query,
			`fields @timestamp, user_id, coalesce(utm_source, "-") as source, coalesce(utm_campaign, "-") as campaign, coalesce(utm_content, "-") as link | filter stream = "analytics" and event = "email_click" and is_authenticated = 1 ${EXCLUDE} | stats count(*) as clicks, count_distinct(user_id) as clickers by source, campaign | sort clickers desc`,
		);
	});

	it("counts plans page views and viewers by source and tier, most viewers first", () => {
		assert.equal(
			widgets.plansViews.query,
			`fields @timestamp, user_id, tier, terms, coalesce(utm_source, "(none)") as source | filter stream = "analytics" and event = "plans_page_viewed" ${EXCLUDE} | stats count(*) as views, count_distinct(user_id) as users by source, tier | sort users desc`,
		);
	});

	it("counts checkouts started by distinct account, because one fires per Subscribe click, by entry source and plan", () => {
		assert.equal(
			widgets.checkoutsStarted.query,
			`fields @timestamp, user_id, variant, plan, coalesce(entry_source, "(none)") as source | filter stream = "subscriptions" and event = "checkout_started" ${EXCLUDE} | stats count_distinct(user_id) as users, count(*) as events by source, plan`,
		);
	});

	it("counts accounts completing checkout by entry source, whether it charged now, and the offer applied", () => {
		assert.equal(
			widgets.checkoutsCompleted.query,
			`fields @timestamp, user_id, paid_now, coalesce(entry_source, "(none)") as source, coalesce(offer, "-") as offer_applied | filter stream = "subscriptions" and event = "checkout_completed" ${EXCLUDE} | stats count_distinct(user_id) as users by source, paid_now, offer_applied`,
		);
	});

	it("counts charged accounts and the first charge", () => {
		assert.equal(
			widgets.charges.query,
			`fields @timestamp, user_id | filter stream = "subscriptions" and event = "charge_succeeded" ${EXCLUDE} | stats count_distinct(user_id) as payers, min(@timestamp) as first_charge`,
		);
	});
});
