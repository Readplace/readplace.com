import type { HutchLogger } from "@packages/hutch-logger";
import type {
	EngagementStarterState,
	RecordEngagementActivity,
} from "@packages/provider-contracts/engagement-starter";
import type { UserId } from "@packages/domain/user";
import { STARTER_CAMPAIGN_ID } from "./starter-policy";

export const ENGAGEMENT_EVENTS = {
	assigned: "starter_assigned",
	inserted: "starter_inserted",
	suppressed: "starter_suppressed",
	failure: "starter_failure",
	sent: "starter_sent",
	activity: "engagement_activity",
	report: "starter_report",
} as const;

export interface EngagementEvent {
	stream: "analytics";
	event: string;
	timestamp: string;
	user_id: UserId;
	campaign_id: string;
	arm?: "treatment" | "comparison";
	assigned_at?: string;
	tier?: "trial" | "paid";
	account_cohort?: "existing" | "new";
	article_id?: string;
	on_suggestion?: boolean;
	activity_kind?: string;
	marked_read?: boolean;
	qualifies_activation?: boolean;
	reason?: string;
	item_count?: number;
}

export function initEngagementEvents(deps: {
	logger: HutchLogger.Typed<EngagementEvent>;
	now: () => Date;
}) {
	return (input: {
		userId: UserId;
		event: "assigned" | "inserted" | "suppressed" | "failure" | "sent";
		campaignId?: string;
		arm?: "treatment" | "comparison";
		assignedAt?: string;
		tier?: "trial" | "paid";
		accountCohort?: "existing" | "new";
		reason?: string;
		itemCount?: number;
	}) => {
		deps.logger.info({
			stream: "analytics",
			event: ENGAGEMENT_EVENTS[input.event],
			timestamp: deps.now().toISOString(),
			user_id: input.userId,
			campaign_id: input.campaignId ?? STARTER_CAMPAIGN_ID,
			arm: input.arm,
			assigned_at: input.assignedAt,
			tier: input.tier,
			account_cohort: input.accountCohort,
			reason: input.reason,
			item_count: input.itemCount,
		});
	};
}

export function initRecordEngagementActivity(deps: {
	state: EngagementStarterState;
	logger: HutchLogger.Typed<EngagementEvent>;
}): RecordEngagementActivity {
	return async (input) => {
		await deps.state.recordEngagementActivity(input);
		const state = await deps.state.findEngagement(input.userId);
		const daysSinceAssignment =
			state.assignment === undefined
				? -1
				: (input.at.getTime() - Date.parse(state.assignment.assignedAt)) / 86_400_000;
		deps.logger.info({
			stream: "analytics",
			event: ENGAGEMENT_EVENTS.activity,
			timestamp: input.at.toISOString(),
			user_id: input.userId,
			campaign_id: state.assignment?.campaignId ?? STARTER_CAMPAIGN_ID,
			arm: state.assignment?.arm,
			assigned_at: state.assignment?.assignedAt,
			article_id: input.articleId?.value,
			on_suggestion: input.campaignId !== undefined,
			activity_kind: input.kind,
			marked_read: input.markedRead,
			qualifies_activation:
				daysSinceAssignment >= 0 &&
				daysSinceAssignment < 7 &&
				(input.kind === "personal-save" ||
					input.kind === "mcp-content" ||
					input.kind === "mcp-summary" ||
					(input.kind === "read-status" && input.markedRead === true)),
		});
	};
}
