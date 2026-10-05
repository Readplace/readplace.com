import assert from "node:assert";
import { createHash } from "node:crypto";
import { z } from "zod";
import { ForwardableSenderSchema, type GmailConnectionStore, type GmailSenderStore } from "@packages/domain/gmail";
import type { DetectNewsletters } from "@packages/domain/newsletter-catalog";
import { UserIdSchema } from "@packages/domain/user";
import { SendGmailNewsletterNoticeCommand, GmailNewsletterNoticeProcessedEvent } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { HutchLogger } from "@packages/hutch-logger";
import type { FindEmailByUserId } from "@packages/provider-contracts/auth";
import type { EmailMessage, SendEmail } from "@packages/provider-contracts/email";
import type { GmailMonitoringStore } from "@packages/provider-contracts/gmail-monitoring";
import type { Handler, SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from "aws-lambda";
import { GMAIL_PATH } from "../../web/pages/integrations/gmail.url";
import { GmailNewsletterNoticeEmail } from "../../web/auth/gmail-newsletter-notice-email";

const RETRY_WINDOW_MS = 24 * 60 * 60 * 1_000 - 5 * 60 * 1_000;
const Envelope = z.object({ "detail-type": z.literal(SendGmailNewsletterNoticeCommand.detailType).optional(), detail: SendGmailNewsletterNoticeCommand.detailSchema });

export function initSendGmailNewsletterNoticeHandler(deps: {
	monitoring: GmailMonitoringStore;
	connections: GmailConnectionStore;
	senders: GmailSenderStore;
	detectNewsletters: DetectNewsletters;
	findEmailByUserId: FindEmailByUserId;
	sendEmail: SendEmail;
	founderAvatarUrl: string;
	appOrigin: string;
	now: () => Date;
	publishEvent: PublishEvent;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];
		for (const record of event.Records) {
			try {
				const { detail } = Envelope.parse(JSON.parse(record.body));
				const userId = UserIdSchema.parse(detail.userId);
				const senderEmail = ForwardableSenderSchema.parse(detail.senderEmail);
				const publish = (outcome: "sent" | "suppressed") => deps.publishEvent(GmailNewsletterNoticeProcessedEvent, { userId, senderEmail, outcome });
				const notice = await deps.monitoring.findNotice({ userId, senderEmail });
				if (notice === undefined || notice.status === "cancelled" || notice.status === "sent") {
					await publish(notice?.status === "sent" ? "sent" : "suppressed");
					continue;
				}
				const [connection, mapping, checkpoint] = await Promise.all([
					deps.connections.findConnectionByUserId(userId), deps.senders.findSender({ userId, senderEmail }), deps.monitoring.findCheckpoint(userId),
				]);
				const matching = connection !== undefined && connection.revokedAt === undefined && connection.disconnectRequestedAt === undefined && connection.gatewayAddress === notice.gatewayAddress && connection.accountEmail?.toLowerCase() === notice.accountEmail.toLowerCase() && checkpoint?.mailboxId === notice.mailboxId;
				if (!matching || mapping?.addedToFilterAt !== undefined) {
					await deps.monitoring.cancelNotice({ userId, senderEmail });
					await publish("suppressed");
					continue;
				}
				const detection = await deps.detectNewsletters([senderEmail]);
				if (detection.status === "unavailable") throw new Error("Newsletter catalog unavailable before notification");
				const recognition = detection.recognized.get(senderEmail);
				const email = await deps.findEmailByUserId(userId);
				if (recognition === undefined || email === null) {
					await deps.monitoring.cancelNotice({ userId, senderEmail });
					await publish("suppressed");
					continue;
				}
				if (notice.firstAttemptAt !== undefined && deps.now().getTime() - notice.firstAttemptAt >= RETRY_WINDOW_MS) throw new Error("Gmail newsletter notice delivery is unresolved outside the provider idempotency window; manual review required");
				const url = new URL(GMAIL_PATH, deps.appOrigin);
				url.searchParams.set("sender", senderEmail);
				url.searchParams.set("notification", "1");
				url.searchParams.set("readlist_choice_for", senderEmail);
				url.searchParams.set("utm_source", "gmail-newsletter-notice");
				url.searchParams.set("utm_medium", "email");
				url.searchParams.set("utm_campaign", "gmail-newsletter-mapping");
				url.searchParams.set("utm_content", "choose-readlist");
				const component = GmailNewsletterNoticeEmail({ founderAvatarUrl: deps.founderAvatarUrl, newsletterName: recognition.name, senderEmail, gmailUrl: url.toString() });
				const message: EmailMessage = notice.message ?? {
					from: "Readplace <fayner@readplace.com>", replyTo: "fayner@readplace.com", to: email,
					subject: `Choose readlists for ${recognition.name ?? senderEmail}`,
					html: component.to("text/html"), text: component.to("text/plain"),
					idempotencyKey: `gmail-newsletter/${createHash("sha256").update(JSON.stringify([userId, senderEmail])).digest("hex")}`,
				};
				const claim = await deps.monitoring.claimNotice({ notice, message });
				assert(claim?.message, "Gmail newsletter notice already claimed; retry after the lease");
				await deps.sendEmail(claim.message);
				await deps.monitoring.markNoticeSent({ userId, senderEmail });
				await publish("sent");
			} catch (error) {
				deps.logger.error("[gmail-newsletter-notice] record failed", { messageId: record.messageId, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}
		return { batchItemFailures };
	};
}
