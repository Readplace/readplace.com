import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { initSqsRecordHandler } from "@packages/infra-components/runtime";
import { SubscriptionCancelledEvent } from "@packages/infra-components";
import type { Logger } from "@packages/logger";
import type {
	CreateTrialFeedbackEmailSchedule,
	DeleteTrialFeedbackEmailSchedule,
} from "@packages/provider-contracts/trial-scheduler";

/** Three days after the trial-cancel arrives. Long enough that the email
 * doesn't read as automated reaction to the cancel click, short enough that
 * the reason is still fresh in the recipient's mind. */
export const TRIAL_FEEDBACK_EMAIL_DELAY_MS = 3 * 24 * 60 * 60 * 1000;

const TRIAL_END_CANCEL_REASONS: ReadonlySet<string> = new Set([
	"user_initiated_trial",
	"trial_expired_no_card",
	"trial_expired_charge_failed",
]);

export function initScheduleTrialFeedbackEmailHandler(deps: {
	createTrialFeedbackEmailSchedule: CreateTrialFeedbackEmailSchedule;
	deleteTrialFeedbackEmailSchedule: DeleteTrialFeedbackEmailSchedule;
	now: () => Date;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	return initSqsRecordHandler({
		definition: SubscriptionCancelledEvent,
		logger: deps.logger,
		failure: { message: "[schedule-trial-feedback-email] record failed" },
		malformed: { policy: "retry" },
		handle: async (detail) => {
			if (!TRIAL_END_CANCEL_REASONS.has(detail.reason)) {
				deps.logger.info(
					"[schedule-trial-feedback-email] non-trial cancel — noop",
					{ userId: detail.userId, reason: detail.reason },
				);
				return;
			}
			const { userId } = detail;
			const firesAt = new Date(
				deps.now().getTime() + TRIAL_FEEDBACK_EMAIL_DELAY_MS,
			).toISOString();
			/* SubscriptionCancelledEvent is at-least-once and has two publishers,
			 * so this handler must tolerate a re-delivery. The schedule name is
			 * deterministic but CreateSchedule rejects an existing name, so the
			 * stale one is removed first (a no-op when there is none). */
			await deps.deleteTrialFeedbackEmailSchedule({ userId });
			await deps.createTrialFeedbackEmailSchedule({ userId, firesAt });
			deps.logger.info(
				"[schedule-trial-feedback-email] schedule created",
				{ userId, firesAt },
			);
		},
	});
}
