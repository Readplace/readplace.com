import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import { SubscriptionCancelledEvent } from "@packages/hutch-infra-components";
import type { HutchLogger } from "@packages/hutch-logger";
import type { CreateTrialFeedbackEmailSchedule } from "@packages/test-fixtures/providers/trial-scheduler";

/** Three days after the trial-cancel arrives. Long enough that the email
 * doesn't read as automated reaction to the cancel click, short enough that
 * the reason is still fresh in the recipient's mind. */
export const TRIAL_FEEDBACK_EMAIL_DELAY_MS = 3 * 24 * 60 * 60 * 1000;

export function initScheduleTrialFeedbackEmailHandler(deps: {
	createTrialFeedbackEmailSchedule: CreateTrialFeedbackEmailSchedule;
	now: () => Date;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = z
					.object({ detail: z.unknown() })
					.parse(JSON.parse(record.body));
				const detail = SubscriptionCancelledEvent.detailSchema.parse(
					envelope.detail,
				);
				if (detail.reason !== "user_initiated_trial") {
					deps.logger.info(
						"[schedule-trial-feedback-email] non-trial cancel — noop",
						{ userId: detail.userId, reason: detail.reason },
					);
					continue;
				}
				const userId = UserIdSchema.parse(detail.userId);
				const firesAt = new Date(
					deps.now().getTime() + TRIAL_FEEDBACK_EMAIL_DELAY_MS,
				).toISOString();
				await deps.createTrialFeedbackEmailSchedule({ userId, firesAt });
				deps.logger.info(
					"[schedule-trial-feedback-email] schedule created",
					{ userId, firesAt },
				);
			} catch (error) {
				deps.logger.error("[schedule-trial-feedback-email] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
