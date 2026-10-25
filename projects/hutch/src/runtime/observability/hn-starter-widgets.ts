import { ENGAGEMENT_EVENTS } from "../domain/engagement/engagement-events";
import { ANALYTICS_EVENTS, STREAMS } from "./events";
import { type ExcludedIdentities, excludeNonAudienceClauses } from "./excluded-identities";
import type { LogWidgetSpec } from "./log-widget-spec.types";

export function hnStarterWidgets(deps: {
	analyticsLogGroupName: string;
	identities: ExcludedIdentities;
}) {
	const analyticsSource = [deps.analyticsLogGroupName];
	const exclude = excludeNonAudienceClauses(deps.identities);

	return {
		deliveryOutcomes: {
			title: "Hacker News starter — assignments, insertions and delivery outcomes",
			logGroupNames: analyticsSource,
			query: [
				"fields @timestamp, user_id, campaign_id, event, arm, reason",
				`| filter stream = "${STREAMS.analytics}" and event in ["${ENGAGEMENT_EVENTS.assigned}", "${ENGAGEMENT_EVENTS.inserted}", "${ENGAGEMENT_EVENTS.sent}", "${ENGAGEMENT_EVENTS.suppressed}", "${ENGAGEMENT_EVENTS.failure}"]`,
				...exclude,
				"| stats count(*) as events, count_distinct(user_id) as accounts by campaign_id, event, arm, reason",
				"| sort events desc",
			].join(" "),
			x: 0, y: 274, width: 24, height: 8,
			view: "table",
		},
		readerActivity: {
			title: "Hacker News starter — reader visits, suggestion reads and personal saves",
			logGroupNames: analyticsSource,
			query: [
				"fields @timestamp, user_id, campaign_id, activity_kind, marked_read, on_suggestion, arm, assigned_at, article_id",
				`| filter stream = "${STREAMS.analytics}" and event = "${ENGAGEMENT_EVENTS.activity}"`,
				...exclude,
				"| filter ispresent(assigned_at)",
				"| stats count(*) as actions, count_distinct(user_id) as accounts by campaign_id, arm, activity_kind, marked_read, on_suggestion",
				"| sort actions desc",
			].join(" "),
			x: 0, y: 282, width: 12, height: 8,
			view: "table",
		},
		unsubscribesByArm: {
			title: "Hacker News starter — unsubscribes by original assignment",
			logGroupNames: analyticsSource,
			query: [
				`fields @timestamp, user_id, arm, campaign_id, if(event = "${ANALYTICS_EVENTS.queueDigestUnsubscribed}", 1, 0) as is_unsubscribe`,
				`| filter stream = "${STREAMS.analytics}" and (event = "${ENGAGEMENT_EVENTS.assigned}" or event = "${ANALYTICS_EVENTS.queueDigestUnsubscribed}")`,
				...exclude,
				"| stats earliest(arm) as original_arm, earliest(campaign_id) as campaign, sum(is_unsubscribe) as unsubscribes by user_id",
				"| filter ispresent(original_arm) and unsubscribes > 0",
				"| stats count(*) as accounts by campaign, original_arm",
			].join(" "),
			x: 12, y: 282, width: 12, height: 8,
			view: "table",
		},
		latestReport: {
			title: "Hacker News starter — latest experiment report (logged every 6 hours)",
			logGroupNames: analyticsSource,
			query: [
				`filter stream = "${STREAMS.analytics}" and event = "${ENGAGEMENT_EVENTS.report}" and cohort = "all"`,
				"| stats latest(@timestamp) as as_of, latest(conclusion) as verdict, latest(formal_review_due) as review_due,",
				"latest(difference_pp) as diff_pp, latest(ci_low_pp) as ci_low, latest(ci_high_pp) as ci_high, latest(fisher_p) as p_value,",
				"latest(treatment.activated) as t_activated, latest(treatment.mature) as t_mature, latest(treatment.immature) as t_immature, latest(treatment.assigned) as t_assigned,",
				"latest(comparison.activated) as c_activated, latest(comparison.mature) as c_mature, latest(comparison.immature) as c_immature, latest(comparison.assigned) as c_assigned,",
				"latest(treatment.inserted) as t_inserted, latest(treatment.insertionFailed) as t_insertion_failed, latest(treatment.sent) as t_sent, latest(treatment.suppressed) as t_suppressed, latest(treatment.review) as t_review",
				"by campaign_id",
			].join(" "),
			x: 0, y: 290, width: 24, height: 6,
			view: "table",
		},
		latestReportByCohort: {
			title: "Hacker News starter — latest report by tier and account cohort",
			logGroupNames: analyticsSource,
			query: [
				`filter stream = "${STREAMS.analytics}" and event = "${ENGAGEMENT_EVENTS.report}" and cohort != "all"`,
				"| stats latest(@timestamp) as as_of,",
				"latest(treatment.activated) as t_activated, latest(treatment.mature) as t_mature, latest(treatment.assigned) as t_assigned,",
				"latest(comparison.activated) as c_activated, latest(comparison.mature) as c_mature, latest(comparison.assigned) as c_assigned",
				"by campaign_id, cohort",
				"| sort cohort asc",
			].join(" "),
			x: 0, y: 296, width: 12, height: 8,
			view: "table",
		},
		activatedOverTime: {
			title: "Hacker News starter — activated and mature accounts by arm over time",
			logGroupNames: analyticsSource,
			query: [
				`filter stream = "${STREAMS.analytics}" and event = "${ENGAGEMENT_EVENTS.report}" and cohort = "all"`,
				"| stats max(treatment.activated) as treatment_activated, max(treatment.mature) as treatment_mature,",
				"max(comparison.activated) as comparison_activated, max(comparison.mature) as comparison_mature",
				"by bin(6h)",
			].join(" "),
			x: 12, y: 296, width: 12, height: 8,
			view: "timeSeries",
		},
	} satisfies Record<string, LogWidgetSpec>;
}
