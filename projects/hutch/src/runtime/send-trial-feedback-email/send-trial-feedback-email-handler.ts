import type {
	Handler,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import assert from "node:assert";
import type { UserId } from "@packages/domain/user";
import { initSqsRecordHandler } from "@packages/infra-components/runtime";
import { SendTrialFeedbackEmailCommand, type SendTrialFeedbackEmailDetail } from "@packages/infra-components";
import type { Logger } from "@packages/logger";
import type { FindEmailByUserId, FindUserContactByUserId } from "@packages/provider-contracts/auth";
import type { FindArticlesByUser } from "@packages/provider-contracts/article-store";
import {
	EmailKeyReusedError,
	type EmailMessage,
	type SendEmail,
} from "@packages/provider-contracts/email";
import type { FindOpenInvoiceFailure } from "@packages/provider-contracts/subscription-billing";
import type {
	ClaimTrialNudge,
	ReleaseTrialNudge,
	FindSubscriptionByUserId,
	MarkAutomationSavesHeldEmailSent,
	MarkPaymentFailedEmailSent,
	MarkTrialFeedbackEmailSent,
	MarkTrialReminderEmailSent,
} from "@packages/provider-contracts/subscription-providers";
import { sendTrialDay3Email } from "./send-trial-day3-email";
import { sendTrialDay7Email } from "./send-trial-day7-email";
import { resolveWriteAccess } from "@packages/subscription-access";
import {
	CUSTOM_EMAILS_PATH,
	buildInboxHighlightUrl,
} from "@packages/domain/inbox";
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
import {
	AutomationSavesHeldEmail,
	AUTOMATION_SAVES_HELD_EMAIL_SUBJECT,
} from "../web/auth/automation-saves-held-email";
import { trialDayOf } from "../domain/trial/trial-day";
import type { EmitLifecycleEmailSent } from "../observability/lifecycle-email-events";

const EMAIL_FROM = "Readplace <readplace@readplace.com>";
const EMAIL_REPLY_TO = "fayner@readplace.com";
const EMAIL_BCC = "readplace+trial_feedback@readplace.com";
const REMINDER_EMAIL_BCC = "readplace+trial_reminder@readplace.com";
const CHARGE_REMINDER_EMAIL_BCC = "readplace+charge_reminder@readplace.com";
const PAYMENT_FAILED_EMAIL_BCC = "readplace+payment_failed@readplace.com";
const AUTOMATION_SAVES_HELD_EMAIL_BCC = "readplace+automation_saves_held@readplace.com";

export interface SendTrialFeedbackEmailDeps {
	findSubscriptionByUserId: FindSubscriptionByUserId;
	findEmailByUserId: FindEmailByUserId;
	findArticlesByUser: FindArticlesByUser;
	markTrialFeedbackEmailSent: MarkTrialFeedbackEmailSent;
	markTrialReminderEmailSent: MarkTrialReminderEmailSent;
	markAutomationSavesHeldEmailSent: MarkAutomationSavesHeldEmailSent;
	markPaymentFailedEmailSent: MarkPaymentFailedEmailSent;
	findOpenInvoiceFailure: FindOpenInvoiceFailure;
	claimTrialNudge: ClaimTrialNudge;
	releaseTrialNudge: ReleaseTrialNudge;
	findUserContactByUserId: FindUserContactByUserId;
	signUnsubscribeToken: (userId: UserId) => string;
	sendEmail: SendEmail;
	founderAvatarUrl: string;
	appOrigin: string;
	now: () => Date;
	logger: Logger;
	emitLifecycleEmailSent: EmitLifecycleEmailSent;
}

type KindHandler = (
	input: { userId: UserId; messageId: string; detail: SendTrialFeedbackEmailDetail },
	deps: SendTrialFeedbackEmailDeps,
) => Promise<void>;

const KIND_HANDLERS = {
	feedback: ({ userId }, deps) => processCommand(userId, deps),
	reminder: ({ userId }, deps) => processReminder(userId, deps),
	charge_reminder: ({ userId, detail }, deps) => processChargeReminder(userId, detail.chargeAt, deps),
	payment_failed: ({ userId }, deps) => processPaymentFailed(userId, deps),
	automation_saves_held: ({ userId, detail }, deps) =>
		processAutomationSavesHeld(
			userId,
			{ receivedAtMessageId: detail.receivedAtMessageId, inboxAddress: detail.inboxAddress },
			deps,
		),
	trial_day3: ({ userId, messageId }, deps) => sendTrialDay3Email({ userId, messageId }, deps),
	trial_day7: ({ userId, messageId }, deps) => sendTrialDay7Email({ userId, messageId }, deps),
} satisfies Record<NonNullable<SendTrialFeedbackEmailDetail["kind"]>, KindHandler>;

export function initSendTrialFeedbackEmailHandler(
	deps: SendTrialFeedbackEmailDeps,
): Handler<SQSEvent, SQSBatchResponse> {
	return initSqsRecordHandler({
		definition: SendTrialFeedbackEmailCommand,
		logger: deps.logger,
		failure: { message: "[send-trial-feedback-email] record failed" },
		malformed: { policy: "retry" },
		handle: (detail, record) =>
			KIND_HANDLERS[detail.kind ?? "feedback"](
				{ userId: detail.userId, messageId: record.messageId, detail },
				deps,
			),
	});
}

async function sendUnlessKeyReused(
	message: EmailMessage,
	deps: SendTrialFeedbackEmailDeps,
): Promise<void> {
	try {
		await deps.sendEmail(message);
	} catch (error) {
		if (!(error instanceof EmailKeyReusedError)) throw error;
		deps.logger.warn(
			"[send-trial-feedback-email] idempotency key already used with another payload — counted as sent",
			{ idempotencyKey: message.idempotencyKey },
		);
	}
}

async function processCommand(
	userId: UserId,
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

	if (row.founderNoteSentAt) {
		deps.logger.info(
			"[send-trial-feedback-email] founder already wrote — noop",
			{ userId, founderNoteSentAt: row.founderNoteSentAt },
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

	await sendUnlessKeyReused(
		{
			from: EMAIL_FROM,
			to: email,
			bcc: EMAIL_BCC,
			replyTo: EMAIL_REPLY_TO,
			subject: TRIAL_FEEDBACK_EMAIL_SUBJECT,
			html: component.to("text/html"),
			text: component.to("text/plain"),
			idempotencyKey: `trial-feedback/${userId}`,
		},
		deps,
	);

	deps.emitLifecycleEmailSent({
		userId,
		kind: "trial-feedback",
		trialDay: null,
		utmSource: null,
		delivery: "automated",
	});

	const sentAt = deps.now().toISOString();
	await deps.markTrialFeedbackEmailSent({ userId, sentAt });
	deps.logger.info("[send-trial-feedback-email] sent", {
		userId,
		savedArticlesCount: total,
		sentAt,
	});
}

function trackedUrl(input: { appOrigin: string; path: string; content: string }): string {
	const url = new URL(input.path, input.appOrigin);
	url.searchParams.set("utm_source", "automation-saves-held");
	url.searchParams.set("utm_medium", "email");
	url.searchParams.set("utm_campaign", "lapsed-inbox-save");
	url.searchParams.set("utm_content", input.content);
	return url.toString();
}

async function processAutomationSavesHeld(
	userId: UserId,
	arrival: { receivedAtMessageId: string | undefined; inboxAddress: string | undefined },
	deps: SendTrialFeedbackEmailDeps,
): Promise<void> {
	const row = await deps.findSubscriptionByUserId(userId);
	if (resolveWriteAccess(row, deps.now()) === "full") {
		deps.logger.info(
			"[send-trial-feedback-email] automation-saves-held: reader can save again — noop",
			{ userId, status: row?.status },
		);
		return;
	}
	if (row?.automationSavesHeldEmailSentAt) {
		deps.logger.info(
			"[send-trial-feedback-email] automation-saves-held: already sent — noop",
			{ userId, sentAt: row.automationSavesHeldEmailSentAt },
		);
		return;
	}

	const email = await deps.findEmailByUserId(userId);
	if (!email) {
		deps.logger.info(
			"[send-trial-feedback-email] automation-saves-held: no email on file — noop",
			{ userId },
		);
		return;
	}

	const sentAt = deps.now().toISOString();
	const claim = await deps.markAutomationSavesHeldEmailSent({ userId, sentAt });
	if (claim === "already-sent") {
		deps.logger.info(
			"[send-trial-feedback-email] automation-saves-held: another delivery sent it — noop",
			{ userId },
		);
		return;
	}

	const component = AutomationSavesHeldEmail({
		founderAvatarUrl: deps.founderAvatarUrl,
		inboxAddress: arrival.inboxAddress,
		inboxUrl: trackedUrl({
			appOrigin: deps.appOrigin,
			path: buildInboxHighlightUrl({ receivedAtMessageId: arrival.receivedAtMessageId }),
			content: "open-inbox",
		}),
		reactivateUrl: trackedUrl({
			appOrigin: deps.appOrigin,
			path: "/account",
			content: "reactivate",
		}),
		manageAddressesUrl: trackedUrl({
			appOrigin: deps.appOrigin,
			path: CUSTOM_EMAILS_PATH,
			content: "manage-addresses",
		}),
	});

	await deps.sendEmail({
		from: EMAIL_FROM,
		to: email,
		bcc: AUTOMATION_SAVES_HELD_EMAIL_BCC,
		replyTo: EMAIL_REPLY_TO,
		subject: AUTOMATION_SAVES_HELD_EMAIL_SUBJECT,
		html: component.to("text/html"),
		text: component.to("text/plain"),
	});

	deps.logger.info("[send-trial-feedback-email] automation-saves-held sent", {
		userId,
		sentAt,
	});
}

async function processReminder(
	userId: UserId,
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
	if (row.payDigestEmailSentAt) {
		deps.logger.info(
			"[send-trial-feedback-email] reminder: pay digest already sent — noop",
			{ userId, sentAt: row.payDigestEmailSentAt },
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
		ctaUrl: `${deps.appOrigin}/account?utm_source=trial-reminder&utm_medium=email&utm_campaign=trial-preexpiry&utm_content=subscribe`,
	});

	await sendUnlessKeyReused(
		{
			from: EMAIL_FROM,
			to: email,
			bcc: REMINDER_EMAIL_BCC,
			replyTo: EMAIL_REPLY_TO,
			subject: TRIAL_REMINDER_EMAIL_SUBJECT,
			html: component.to("text/html"),
			text: component.to("text/plain"),
			idempotencyKey: `trial-reminder/${userId}/${row.trialEndsAt}`,
		},
		deps,
	);

	deps.emitLifecycleEmailSent({
		userId,
		kind: "trial-reminder",
		trialDay: trialDayOf({ trialEndsAt: row.trialEndsAt, at: deps.now() }),
		utmSource: "trial-reminder",
		delivery: "automated",
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
	userId: UserId,
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
		ctaUrl: `${deps.appOrigin}/account?utm_source=charge-reminder&utm_medium=email&utm_campaign=trial-precharge&utm_content=manage-subscription`,
		plan: row.plan,
	});

	await sendUnlessKeyReused(
		{
			from: EMAIL_FROM,
			to: email,
			bcc: CHARGE_REMINDER_EMAIL_BCC,
			replyTo: EMAIL_REPLY_TO,
			subject: component.subject,
			html: component.to("text/html"),
			text: component.to("text/plain"),
			idempotencyKey: `charge-reminder/${userId}/${chargeAt}`,
		},
		deps,
	);

	deps.emitLifecycleEmailSent({
		userId,
		kind: "charge-reminder",
		trialDay: trialDayOf({ trialEndsAt: chargeAt, at: deps.now() }),
		utmSource: "charge-reminder",
		delivery: "automated",
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
	userId: UserId,
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
	if (!row.subscriptionId) {
		deps.logger.info(
			"[send-trial-feedback-email] payment-failed: no subscription id — noop",
			{ userId },
		);
		return;
	}

	const failure = await deps.findOpenInvoiceFailure({ subscriptionId: row.subscriptionId });
	if (!failure) {
		deps.logger.info(
			"[send-trial-feedback-email] payment-failed: no open invoice failure — noop",
			{ userId, subscriptionId: row.subscriptionId },
		);
		return;
	}
	const attempt = `${failure.invoiceId}/${failure.attemptCount}`;
	if (row.paymentFailedEmailAttempt === attempt) {
		deps.logger.info(
			"[send-trial-feedback-email] payment-failed: attempt already emailed — noop",
			{ userId, attempt },
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
		ctaUrl: `${deps.appOrigin}/account?utm_source=payment-failed&utm_medium=email&utm_campaign=dunning&utm_content=update-card`,
	});

	await sendUnlessKeyReused(
		{
			from: EMAIL_FROM,
			to: email,
			bcc: PAYMENT_FAILED_EMAIL_BCC,
			replyTo: EMAIL_REPLY_TO,
			subject: PAYMENT_FAILED_EMAIL_SUBJECT,
			html: component.to("text/html"),
			text: component.to("text/plain"),
			idempotencyKey: `payment-failed/${attempt}`,
		},
		deps,
	);

	await deps.markPaymentFailedEmailSent({ userId, attempt });
	deps.logger.info("[send-trial-feedback-email] payment-failed email sent", {
		userId,
		attempt,
	});
}
