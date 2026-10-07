import assert from "node:assert";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { ForwardableSender, GmailConnectionStore, GmailMappingStore } from "@packages/domain/gmail";
import type { DetectNewsletters } from "@packages/domain/newsletter-catalog";
import { UserIdSchema, type UserId } from "@packages/domain/user";
import { SendGmailNewsletterNoticeCommand, GmailNewsletterNoticeProcessedEvent } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { HutchLogger } from "@packages/hutch-logger";
import type { ListReadlistDefinitions } from "@packages/provider-contracts/article-store";
import type { FindEmailByUserId } from "@packages/provider-contracts/auth";
import type { EmailMessage, SendEmail } from "@packages/provider-contracts/email";
import type { GmailMonitoringStore, GmailNewsletterNotice, GmailNewsletterNoticeBatch } from "@packages/provider-contracts/gmail-monitoring";
import type { Handler, SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from "aws-lambda";
import { GMAIL_PATH } from "../../web/pages/integrations/gmail.url";
import { GmailNewsletterNoticeEmail } from "../../web/auth/gmail-newsletter-notice-email";
import { GMAIL_NEWSLETTER_NOTICE_INTERVAL_DAYS } from "./gmail-newsletter-notice-cadence";

const RETRY_WINDOW_MS = 24 * 60 * 60 * 1_000 - 5 * 60 * 1_000;
const NOTICE_INTERVAL_MS = GMAIL_NEWSLETTER_NOTICE_INTERVAL_DAYS * 24 * 60 * 60 * 1_000;
const Envelope = z.object({ "detail-type": z.literal(SendGmailNewsletterNoticeCommand.detailType).optional(), detail: SendGmailNewsletterNoticeCommand.detailSchema });

type EligibleNewsletter = { senderEmail: ForwardableSender; newsletterName: string | undefined };

export function initSendGmailNewsletterNoticeHandler(deps: {
	monitoring: GmailMonitoringStore;
	connections: GmailConnectionStore;
	mappings: Pick<GmailMappingStore, "findMapping">;
	detectNewsletters: DetectNewsletters;
	listReadlistDefinitions: ListReadlistDefinitions;
	findEmailByUserId: FindEmailByUserId;
	sendEmail: SendEmail;
	founderAvatarUrl: string;
	appOrigin: string;
	now: () => Date;
	publishEvent: PublishEvent;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const publish = (input: { userId: UserId; senderEmail: ForwardableSender; outcome: "sent" | "suppressed" }) => deps.publishEvent(GmailNewsletterNoticeProcessedEvent, input);

	function gmailUrl(senderEmail: ForwardableSender | undefined): string {
		const url = new URL(GMAIL_PATH, deps.appOrigin);
		if (senderEmail !== undefined) {
			url.searchParams.set("sender", senderEmail);
			url.searchParams.set("notification", "1");
			url.searchParams.set("readlist_choice_for", senderEmail);
		}
		url.searchParams.set("utm_source", "gmail-newsletter-notice");
		url.searchParams.set("utm_medium", "email");
		url.searchParams.set("utm_campaign", "gmail-newsletter-mapping");
		url.searchParams.set("utm_content", senderEmail === undefined ? "choose-readlists" : "choose-readlist");
		return url.toString();
	}

	async function listAllNotices(userId: UserId): Promise<GmailNewsletterNotice[]> {
		const all: GmailNewsletterNotice[] = [];
		let pageToken: string | undefined;
		do {
			const page = await deps.monitoring.listNotices({ userId, pageToken });
			all.push(...page.notices);
			pageToken = page.nextPageToken;
		} while (pageToken !== undefined);
		return all;
	}

	function assertWithinRetryWindow(firstAttemptAt: number): void {
		assert(deps.now().getTime() - firstAttemptAt < RETRY_WINDOW_MS, "Gmail newsletter notice delivery is unresolved outside the provider idempotency window; manual review required");
	}

	async function recordDelivered(input: { userId: UserId; senders: ForwardableSender[] }): Promise<void> {
		for (const senderEmail of input.senders) await deps.monitoring.markNoticeSent({ userId: input.userId, senderEmail });
		for (const senderEmail of input.senders) await publish({ userId: input.userId, senderEmail, outcome: "sent" });
		await deps.monitoring.finishNoticeBatch(input.userId);
	}

	async function claimAndDeliver(input: { userId: UserId; senders: ForwardableSender[]; message: EmailMessage }): Promise<void> {
		const batch = await deps.monitoring.claimNoticeBatch({ ...input, lastSentBefore: deps.now().getTime() - NOTICE_INTERVAL_MS });
		assert(batch, "Gmail newsletter notice batch already claimed; retry after the lease");
		await deps.sendEmail(batch.message);
		await recordDelivered({ userId: input.userId, senders: batch.senders });
	}

	async function eligibleNewsletters(userId: UserId, pending: GmailNewsletterNotice[]): Promise<{ eligible: EligibleNewsletter[]; email: string | null }> {
		const detection = await deps.detectNewsletters(pending.map((notice) => notice.senderEmail));
		if (detection.status === "unavailable") throw new Error("Newsletter catalog unavailable before notification");
		const [connection, checkpoint, email] = await Promise.all([
			deps.connections.findConnectionByUserId(userId), deps.monitoring.findCheckpoint(userId), deps.findEmailByUserId(userId),
		]);
		const eligible: EligibleNewsletter[] = [];
		for (const notice of pending) {
			const mapping = await deps.mappings.findMapping({ userId, accountEmail: notice.accountEmail, senderEmail: notice.senderEmail });
			const matching = connection !== undefined && connection.revokedAt === undefined && connection.disconnectRequestedAt === undefined && connection.gatewayAddress === notice.gatewayAddress && connection.accountEmail?.toLowerCase() === notice.accountEmail.toLowerCase() && checkpoint?.mailboxId === notice.mailboxId;
			const recognition = detection.recognized.get(notice.senderEmail);
			if (!matching || mapping?.addedToFilterAt !== undefined || recognition === undefined || email === null) {
				await deps.monitoring.cancelNotice({ userId, senderEmail: notice.senderEmail });
				await publish({ userId, senderEmail: notice.senderEmail, outcome: "suppressed" });
			} else {
				eligible.push({ senderEmail: notice.senderEmail, newsletterName: recognition.name });
			}
		}
		return { eligible, email };
	}

	function noticeMessage(input: { userId: UserId; email: string; eligible: EligibleNewsletter[] }): { senders: ForwardableSender[]; message: EmailMessage } {
		const ordered = [...input.eligible].sort((a, b) => (a.newsletterName ?? a.senderEmail).localeCompare(b.newsletterName ?? b.senderEmail));
		const senders = ordered.map((newsletter) => newsletter.senderEmail);
		const component = GmailNewsletterNoticeEmail({
			founderAvatarUrl: deps.founderAvatarUrl,
			newsletters: ordered.map((newsletter) => ({ ...newsletter, choiceUrl: gmailUrl(newsletter.senderEmail) })),
			gmailUrl: gmailUrl(undefined),
		});
		return {
			senders,
			message: {
				from: "Readplace <readplace@readplace.com>", replyTo: "fayner@readplace.com", to: input.email,
				subject: component.subject,
				html: component.to("text/html"), text: component.to("text/plain"),
				idempotencyKey: `gmail-newsletter/${createHash("sha256").update(JSON.stringify([input.userId, ...senders])).digest("hex")}`,
			},
		};
	}

	async function notifyPending(userId: UserId, notices: GmailNewsletterNotice[], batch: GmailNewsletterNoticeBatch | undefined): Promise<void> {
		if (batch?.status === "sending") {
			const statusOf = (senderEmail: ForwardableSender) => notices.find((notice) => notice.senderEmail === senderEmail)?.status;
			if (batch.senders.some((senderEmail) => statusOf(senderEmail) === "pending")) {
				assertWithinRetryWindow(batch.firstAttemptAt);
				await claimAndDeliver({ userId, senders: batch.senders, message: batch.message });
				return;
			}
			await recordDelivered({ userId, senders: batch.senders.filter((senderEmail) => statusOf(senderEmail) === "sent") });
			return;
		}
		if (batch !== undefined && deps.now().getTime() - batch.lastSentAt < NOTICE_INTERVAL_MS) {
			deps.logger.info("[gmail-newsletter-notice] held until the notice interval passes", { userId, lastSentAt: batch.lastSentAt });
			return;
		}
		const pending = notices.filter((notice) => notice.status === "pending");
		if (pending.length === 0) return;
		if ((await deps.listReadlistDefinitions(userId)).length === 0) {
			deps.logger.info("[gmail-newsletter-notice] held until the reader has a readlist besides All", { userId, pending: pending.length });
			return;
		}
		const { eligible, email } = await eligibleNewsletters(userId, pending);
		if (eligible.length === 0) return;
		assert(email !== null, "Eligible Gmail newsletter notices always have an account email");
		await claimAndDeliver({ userId, ...noticeMessage({ userId, email, eligible }) });
	}

	async function resendUngroupedClaim(userId: UserId, notice: GmailNewsletterNotice): Promise<void> {
		assert(notice.message, "A claimed Gmail newsletter notice carries its email");
		assert(notice.firstAttemptAt !== undefined, "A claimed Gmail newsletter notice records its first attempt");
		assertWithinRetryWindow(notice.firstAttemptAt);
		const claim = await deps.monitoring.claimNotice({ notice, message: notice.message });
		assert(claim?.message, "Gmail newsletter notice already claimed; retry after the lease");
		await deps.sendEmail(claim.message);
		await deps.monitoring.markNoticeSent({ userId, senderEmail: notice.senderEmail });
		await publish({ userId, senderEmail: notice.senderEmail, outcome: "sent" });
	}

	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];
		for (const record of event.Records) {
			try {
				const { detail } = Envelope.parse(JSON.parse(record.body));
				const userId = UserIdSchema.parse(detail.userId);
				const notices = await listAllNotices(userId);
				await notifyPending(userId, notices, await deps.monitoring.findNoticeBatch(userId));
				for (const notice of notices) {
					if (notice.status === "sending") await resendUngroupedClaim(userId, notice);
				}
			} catch (error) {
				deps.logger.error("[gmail-newsletter-notice] record failed", { messageId: record.messageId, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}
		return { batchItemFailures };
	};
}
