import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import { SendTrialFeedbackEmailCommand } from "@packages/hutch-infra-components";
import type { HutchLogger } from "@packages/hutch-logger";
import type { FindEmailByUserId } from "@packages/test-fixtures/providers/auth";
import type { FindArticlesByUser } from "@packages/test-fixtures/providers/article-store";
import type { SendEmail } from "@packages/test-fixtures/providers/email";
import type {
	FindSubscriptionByUserId,
	MarkTrialFeedbackEmailSent,
} from "@packages/test-fixtures/providers/subscription-providers";
import {
	TrialFeedbackEmail,
	TRIAL_FEEDBACK_EMAIL_SUBJECT,
} from "../web/auth/trial-feedback-email";

const EMAIL_FROM = "Fayner from Readplace <fayner@readplace.com>";
const EMAIL_REPLY_TO = "fayner@readplace.com";
const EMAIL_BCC = "readplace+trial_feedback@readplace.com";

export interface SendTrialFeedbackEmailDeps {
	findSubscriptionByUserId: FindSubscriptionByUserId;
	findEmailByUserId: FindEmailByUserId;
	findArticlesByUser: FindArticlesByUser;
	markTrialFeedbackEmailSent: MarkTrialFeedbackEmailSent;
	sendEmail: SendEmail;
	founderAvatarUrl: string;
	now: () => Date;
	logger: HutchLogger;
}

export function initSendTrialFeedbackEmailHandler(
	deps: SendTrialFeedbackEmailDeps,
): Handler<SQSEvent, SQSBatchResponse> {
	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = z
					.object({ detail: z.unknown() })
					.parse(JSON.parse(record.body));
				const detail = SendTrialFeedbackEmailCommand.detailSchema.parse(
					envelope.detail,
				);
				const userId = UserIdSchema.parse(detail.userId);
				await processCommand(userId, deps);
			} catch (error) {
				deps.logger.error("[send-trial-feedback-email] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}

async function processCommand(
	userId: ReturnType<typeof UserIdSchema.parse>,
	deps: SendTrialFeedbackEmailDeps,
): Promise<void> {
	const row = await deps.findSubscriptionByUserId(userId);
	if (!row) {
		deps.logger.info(
			"[send-trial-feedback-email] no subscription row — noop",
			{ userId },
		);
		return;
	}
	if (row.status !== "cancelled") {
		deps.logger.info(
			"[send-trial-feedback-email] user reactivated during delay window — noop",
			{ userId, status: row.status },
		);
		return;
	}
	if (row.trialFeedbackEmailSentAt) {
		deps.logger.info(
			"[send-trial-feedback-email] already sent — noop",
			{ userId, sentAt: row.trialFeedbackEmailSentAt },
		);
		return;
	}

	const email = await deps.findEmailByUserId(userId);
	if (!email) {
		deps.logger.info(
			"[send-trial-feedback-email] no email on file — noop",
			{ userId },
		);
		return;
	}

	const { total } = await deps.findArticlesByUser({
		userId,
		excludeContent: true,
	});

	const component = TrialFeedbackEmail({
		founderAvatarUrl: deps.founderAvatarUrl,
		savedArticlesCount: total,
	});

	await deps.sendEmail({
		from: EMAIL_FROM,
		to: email,
		bcc: EMAIL_BCC,
		replyTo: EMAIL_REPLY_TO,
		subject: TRIAL_FEEDBACK_EMAIL_SUBJECT,
		html: component.to("text/html"),
		text: component.to("text/plain"),
	});

	const sentAt = deps.now().toISOString();
	await deps.markTrialFeedbackEmailSent({ userId, sentAt });
	deps.logger.info("[send-trial-feedback-email] sent", {
		userId,
		savedArticlesCount: total,
		sentAt,
	});
}
