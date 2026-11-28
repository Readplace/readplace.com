import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { initSqsRecordHandler } from "@packages/infra-components/runtime";
import { SendFirstInboxEmailNoticeCommand } from "@packages/infra-components";
import type { Logger } from "@packages/logger";
import type { FindEmailByUserId } from "@packages/provider-contracts/auth";
import type { SendEmail } from "@packages/provider-contracts/email";
import type { MarkFirstInboxEmailNoticeSent } from "@packages/provider-contracts/onboarding-signals";
import type { FindSubscriptionByUserId } from "@packages/provider-contracts/subscription-providers";
import { hasPaidFeatures, resolveEffectiveAccess } from "@packages/subscription-access";
import { buildInboxHighlightUrl } from "@packages/domain/inbox";
import {
	InboxFirstArrivalEmail,
	INBOX_FIRST_ARRIVAL_EMAIL_SUBJECT,
} from "../web/auth/inbox-first-arrival-email";
import { emailTrackedUrl } from "@packages/web-analytics";

const EMAIL_FROM = "Readplace <readplace@readplace.com>";
const EMAIL_REPLY_TO = "fayner@readplace.com";
const EMAIL_BCC = "readplace+first_inbox_email@readplace.com";

export interface SendFirstInboxEmailNoticeDeps {
	findSubscriptionByUserId: FindSubscriptionByUserId;
	findEmailByUserId: FindEmailByUserId;
	markFirstInboxEmailNoticeSent: MarkFirstInboxEmailNoticeSent;
	sendEmail: SendEmail;
	founderAvatarUrl: string;
	appOrigin: string;
	now: () => Date;
	logger: Logger;
}

function trackedUrl(input: { appOrigin: string; path: string }): string {
	return emailTrackedUrl({
		url: new URL(input.path, input.appOrigin),
		source: "first-inbox-email",
		campaign: "inbox-first-arrival",
		content: "open-inbox",
	});
}

export function initSendFirstInboxEmailNoticeHandler(
	deps: SendFirstInboxEmailNoticeDeps,
): Handler<SQSEvent, SQSBatchResponse> {
	return initSqsRecordHandler({
		definition: SendFirstInboxEmailNoticeCommand,
		logger: deps.logger,
		failure: { message: "[send-first-inbox-email-notice] record failed" },
		malformed: { policy: "retry" },
		handle: async (detail) => {
			const { userId } = detail;

			const row = await deps.findSubscriptionByUserId(userId);
			if (!hasPaidFeatures(resolveEffectiveAccess(row, deps.now()))) {
				deps.logger.info(
					"[send-first-inbox-email-notice] free account — the held notice speaks instead — noop",
					{ userId, status: row?.status },
				);
				return;
			}

			const email = await deps.findEmailByUserId(userId);
			if (!email) {
				deps.logger.info(
					"[send-first-inbox-email-notice] no email on file — noop",
					{ userId },
				);
				return;
			}

			const sentAt = deps.now().toISOString();
			const claim = await deps.markFirstInboxEmailNoticeSent({ userId, sentAt });
			if (claim === "already-sent") {
				deps.logger.info(
					"[send-first-inbox-email-notice] already sent — noop",
					{ userId },
				);
				return;
			}

			const component = InboxFirstArrivalEmail({
				founderAvatarUrl: deps.founderAvatarUrl,
				inboxAddress: detail.inboxAddress,
				inboxUrl: trackedUrl({
					appOrigin: deps.appOrigin,
					path: buildInboxHighlightUrl({
						receivedAtMessageId: detail.receivedAtMessageId,
					}),
				}),
			});

			await deps.sendEmail({
				from: EMAIL_FROM,
				to: email,
				bcc: EMAIL_BCC,
				replyTo: EMAIL_REPLY_TO,
				subject: INBOX_FIRST_ARRIVAL_EMAIL_SUBJECT,
				html: component.to("text/html"),
				text: component.to("text/plain"),
			});

			deps.logger.info("[send-first-inbox-email-notice] sent", {
				userId,
				sentAt,
			});
		},
	});
}
