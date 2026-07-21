import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import assert from "node:assert";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import { SendTrialFeedbackEmailCommand } from "@packages/hutch-infra-components";
import type { HutchLogger } from "@packages/hutch-logger";
import type { FindEmailByUserId } from "@packages/provider-contracts/auth";
import type { FindArticlesByUser } from "@packages/provider-contracts/article-store";
import type { SendEmail } from "@packages/provider-contracts/email";
import type {
	FindSubscriptionByUserId,
	MarkTrialFeedbackEmailSent,
	MarkTrialReminderEmailSent,
} from "@packages/provider-contracts/subscription-providers";
import {
	TrialFeedbackEmail,
	TRIAL_FEEDBACK_EMAIL_SUBJECT,
} from "../web/auth/trial-feedback-email";
import {
	TrialReminderEmail,
	TRIAL_REMINDER_EMAIL_SUBJECT,
} from "../web/auth/trial-reminder-email";
import { ChargeReminderEmail } from "../web/auth/charge-reminder-email";
import {
	PaymentFailedEmail,
	PAYMENT_FAILED_EMAIL_SUBJECT,
} from "../web/auth/payment-failed-email";

const EMAIL_FROM = "Fayner from Readplace <fayner@readplace.com>";
const EMAIL_REPLY_TO = "fayner@readplace.com";
const EMAIL_BCC = "readplace+trial_feedback@readplace.com";
const REMINDER_EMAIL_BCC = "readplace+trial_reminder@readplace.com";
const CHARGE_REMINDER_EMAIL_BCC = "readplace+charge_reminder@readplace.com";
const PAYMENT_FAILED_EMAIL_BCC = "readplace+payment_failed@readplace.com";

export interface SendTrialFeedbackEmailDeps {
	findSubscriptionByUserId: FindSubscriptionByUserId;
	findEmailByUserId: FindEmailByUserId;
	findArticlesByUser: FindArticlesByUser;
	markTrialFeedbackEmailSent: MarkTrialFeedbackEmailSent;
	markTrialReminderEmailSent: MarkTrialReminderEmailSent;
	sendEmail: SendEmail;
	founderAvatarUrl: string;
	appOrigin: string;
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
				if (detail.kind === "reminder") {
					await processReminder(userId, deps);
				} else if (detail.kind === "charge_reminder") {
					await processChargeReminder(userId, detail.chargeAt, deps);
				} else if (detail.kind === "payment_failed") {
					await processPaymentFailed(userId, deps);
				} else {
					await processCommand(userId, deps);
				}
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
		includeTotal: true,
	});
	assert(total !== undefined, "includeTotal query must return a total");

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

async function processReminder(
	userId: ReturnType<typeof UserIdSchema.parse>,
	deps: SendTrialFeedbackEmailDeps,
): Promise<void> {
	const row = await deps.findSubscriptionByUserId(userId);
	if (!row) {
		deps.logger.info(
			"[send-trial-feedback-email] reminder: no subscription row — noop",
			{ userId },
		);
		return;
	}
	if (row.status !== "trialing") {
		deps.logger.info(
			"[send-trial-feedback-email] reminder: user no longer trialing — noop",
			{ userId, status: row.status },
		);
		return;
	}
	if (!row.trialEndsAt || Date.parse(row.trialEndsAt) <= deps.now().getTime()) {
		deps.logger.info(
			"[send-trial-feedback-email] reminder: trial already ended — noop",
			{ userId },
		);
		return;
	}
	if (row.trialReminderEmailSentAt) {
		deps.logger.info(
			"[send-trial-feedback-email] reminder: already sent — noop",
			{ userId, sentAt: row.trialReminderEmailSentAt },
		);
		return;
	}

	const email = await deps.findEmailByUserId(userId);
	if (!email) {
		deps.logger.info(
			"[send-trial-feedback-email] reminder: no email on file — noop",
			{ userId },
		);
		return;
	}

	const { total } = await deps.findArticlesByUser({
		userId,
		excludeContent: true,
		includeTotal: true,
	});
	assert(total !== undefined, "includeTotal query must return a total");

	const component = TrialReminderEmail({
		founderAvatarUrl: deps.founderAvatarUrl,
		savedArticlesCount: total,
		ctaUrl: `${deps.appOrigin}/account?utm_source=trial-reminder&utm_medium=email&utm_campaign=trial-preexpiry`,
	});

	await deps.sendEmail({
		from: EMAIL_FROM,
		to: email,
		bcc: REMINDER_EMAIL_BCC,
		replyTo: EMAIL_REPLY_TO,
		subject: TRIAL_REMINDER_EMAIL_SUBJECT,
		html: component.to("text/html"),
		text: component.to("text/plain"),
	});

	const sentAt = deps.now().toISOString();
	await deps.markTrialReminderEmailSent({ userId, sentAt });
	deps.logger.info("[send-trial-feedback-email] reminder sent", {
		userId,
		savedArticlesCount: total,
		sentAt,
	});
}

async function processChargeReminder(
	userId: ReturnType<typeof UserIdSchema.parse>,
	chargeAt: string | undefined,
	deps: SendTrialFeedbackEmailDeps,
): Promise<void> {
	if (!chargeAt) {
		deps.logger.warn(
			"[send-trial-feedback-email] charge-reminder: command carries no chargeAt — noop",
			{ userId },
		);
		return;
	}
	const row = await deps.findSubscriptionByUserId(userId);
	if (!row) {
		deps.logger.info(
			"[send-trial-feedback-email] charge-reminder: no subscription row — noop",
			{ userId },
		);
		return;
	}
	if (row.status !== "active") {
		deps.logger.info(
			"[send-trial-feedback-email] charge-reminder: user no longer active — noop",
			{ userId, status: row.status },
		);
		return;
	}
	if (Date.parse(chargeAt) <= deps.now().getTime()) {
		deps.logger.info(
			"[send-trial-feedback-email] charge-reminder: charge instant already passed — noop",
			{ userId, chargeAt },
		);
		return;
	}
	if (row.trialReminderEmailSentAt) {
		deps.logger.info(
			"[send-trial-feedback-email] charge-reminder: reminder already sent — noop",
			{ userId, sentAt: row.trialReminderEmailSentAt },
		);
		return;
	}

	const email = await deps.findEmailByUserId(userId);
	if (!email) {
		deps.logger.info(
			"[send-trial-feedback-email] charge-reminder: no email on file — noop",
			{ userId },
		);
		return;
	}

	const component = ChargeReminderEmail({
		founderAvatarUrl: deps.founderAvatarUrl,
		chargeAt,
		ctaUrl: `${deps.appOrigin}/account?utm_source=charge-reminder&utm_medium=email&utm_campaign=trial-precharge`,
	});

	await deps.sendEmail({
		from: EMAIL_FROM,
		to: email,
		bcc: CHARGE_REMINDER_EMAIL_BCC,
		replyTo: EMAIL_REPLY_TO,
		subject: component.subject,
		html: component.to("text/html"),
		text: component.to("text/plain"),
	});

	const sentAt = deps.now().toISOString();
	await deps.markTrialReminderEmailSent({ userId, sentAt });
	deps.logger.info("[send-trial-feedback-email] charge reminder sent", {
		userId,
		chargeAt,
		sentAt,
	});
}

async function processPaymentFailed(
	userId: ReturnType<typeof UserIdSchema.parse>,
	deps: SendTrialFeedbackEmailDeps,
): Promise<void> {
	const row = await deps.findSubscriptionByUserId(userId);
	if (!row) {
		deps.logger.info(
			"[send-trial-feedback-email] payment-failed: no subscription row — noop",
			{ userId },
		);
		return;
	}
	if (row.status !== "active") {
		deps.logger.info(
			"[send-trial-feedback-email] payment-failed: user no longer active — noop",
			{ userId, status: row.status },
		);
		return;
	}

	const email = await deps.findEmailByUserId(userId);
	if (!email) {
		deps.logger.info(
			"[send-trial-feedback-email] payment-failed: no email on file — noop",
			{ userId },
		);
		return;
	}

	const component = PaymentFailedEmail({
		founderAvatarUrl: deps.founderAvatarUrl,
		ctaUrl: `${deps.appOrigin}/account?utm_source=payment-failed&utm_medium=email&utm_campaign=dunning`,
	});

	await deps.sendEmail({
		from: EMAIL_FROM,
		to: email,
		bcc: PAYMENT_FAILED_EMAIL_BCC,
		replyTo: EMAIL_REPLY_TO,
		subject: PAYMENT_FAILED_EMAIL_SUBJECT,
		html: component.to("text/html"),
		text: component.to("text/plain"),
	});

	deps.logger.info("[send-trial-feedback-email] payment-failed email sent", {
		userId,
	});
}
