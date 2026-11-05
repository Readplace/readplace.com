import { ANALYTICS_EVENTS, CONVERSION_EVENTS, LIFECYCLE_EMAIL_EVENTS, STREAMS, SUBSCRIPTION_EVENTS } from "./events";
import { type ExcludedIdentities, excludeNonAudienceClauses } from "./excluded-identities";
import type { LogWidgetSpec } from "./log-widget-spec.types";

export function keepEngineWidgets(deps: {
	analyticsLogGroupName: string;
	identities: ExcludedIdentities;
}) {
	const analyticsSource = [deps.analyticsLogGroupName];
	const exclude = excludeNonAudienceClauses(deps.identities);

	return {
		trialsByClient: {
			title: "Keep Readplace engine — trials started by client",
			logGroupNames: analyticsSource,
			query: [
				'fields @timestamp, user_id, coalesce(oauth_client_id, "web") as client, method',
				`| filter stream = "${STREAMS.conversions}" and event = "${CONVERSION_EVENTS.userCreated}" and tier = "trial"`,
				...exclude,
				"| stats count_distinct(user_id) as trials by client",
			].join(" "),
			x: 0, y: 0, width: 12, height: 6,
			view: "table",
		},
		panelReach: {
			title: "Keep Readplace engine — threshold crossings, panel shows and panel clicks",
			logGroupNames: analyticsSource,
			query: [
				'fields @timestamp, event, user_id, coalesce(surface, "-") as panel_surface',
				`| filter event in ["${ANALYTICS_EVENTS.activationThresholdReached}", "${ANALYTICS_EVENTS.keepOfferShown}", "${ANALYTICS_EVENTS.keepOfferClicked}"]`,
				...exclude,
				"| stats count(*) as events, count_distinct(user_id) as users by event, panel_surface",
			].join(" "),
			x: 12, y: 0, width: 12, height: 6,
			view: "table",
		},
		lifecycleSends: {
			title: "Keep Readplace engine — lifecycle email sends by kind",
			logGroupNames: analyticsSource,
			query: [
				"fields @timestamp, user_id, kind, trial_day",
				`| filter event = "${LIFECYCLE_EMAIL_EVENTS.sent}"`,
				...exclude,
				"| stats count(*) as sends, count_distinct(user_id) as recipients by kind",
			].join(" "),
			x: 0, y: 6, width: 12, height: 8,
			view: "table",
		},
		emailClicks: {
			title: "Keep Readplace engine — signed-in email clicks by source and campaign",
			logGroupNames: analyticsSource,
			query: [
				'fields @timestamp, user_id, coalesce(utm_source, "-") as source, coalesce(utm_campaign, "-") as campaign, coalesce(utm_content, "-") as link',
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.emailClick}" and is_authenticated = 1`,
				...exclude,
				"| stats count(*) as clicks, count_distinct(user_id) as clickers by source, campaign",
				"| sort clickers desc",
			].join(" "),
			x: 12, y: 6, width: 12, height: 8,
			view: "table",
		},
		plansViews: {
			title: "Keep Readplace engine — plans page views by source and tier",
			logGroupNames: analyticsSource,
			query: [
				'fields @timestamp, user_id, tier, terms, coalesce(utm_source, "(none)") as source',
				`| filter stream = "${STREAMS.analytics}" and event = "${ANALYTICS_EVENTS.plansPageViewed}"`,
				...exclude,
				"| stats count(*) as views, count_distinct(user_id) as users by source, tier",
				"| sort users desc",
			].join(" "),
			x: 0, y: 14, width: 12, height: 8,
			view: "table",
		},
		checkoutsStarted: {
			title: "Keep Readplace engine — checkouts started by entry source and plan",
			logGroupNames: analyticsSource,
			query: [
				'fields @timestamp, user_id, variant, plan, coalesce(entry_source, "(none)") as source',
				`| filter stream = "${STREAMS.subscriptions}" and event = "${SUBSCRIPTION_EVENTS.checkoutStarted}"`,
				...exclude,
				"| stats count_distinct(user_id) as users, count(*) as events by source, plan",
			].join(" "),
			x: 12, y: 14, width: 12, height: 8,
			view: "table",
		},
		checkoutsCompleted: {
			title: "Keep Readplace engine — checkouts completed by entry source, charge and offer",
			logGroupNames: analyticsSource,
			query: [
				'fields @timestamp, user_id, paid_now, coalesce(entry_source, "(none)") as source, coalesce(offer, "-") as offer_applied',
				`| filter stream = "${STREAMS.subscriptions}" and event = "${SUBSCRIPTION_EVENTS.checkoutCompleted}"`,
				...exclude,
				"| stats count_distinct(user_id) as users by source, paid_now, offer_applied",
			].join(" "),
			x: 0, y: 22, width: 12, height: 8,
			view: "table",
		},
		charges: {
			title: "Keep Readplace engine — accounts charged by the start-request handler",
			logGroupNames: analyticsSource,
			query: [
				"fields @timestamp, user_id",
				`| filter stream = "${STREAMS.subscriptions}" and event = "${SUBSCRIPTION_EVENTS.chargeSucceeded}"`,
				...exclude,
				"| stats count_distinct(user_id) as payers, min(@timestamp) as first_charge",
			].join(" "),
			x: 12, y: 22, width: 12, height: 8,
			view: "table",
		},
	} satisfies Record<string, LogWidgetSpec>;
}
