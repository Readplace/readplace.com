import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { z } from "zod";
import { EmailReceivedEvent } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { HutchLogger } from "@packages/hutch-logger";
import {
	type InboxAddress,
	type InboxAddressEntry,
	InboxAddressSchema,
	type InboxAddressStore,
	type InboxEmailEntry,
	type InboxEmailStore,
	MessageIdSchema,
	type ParseEmailResult,
} from "@packages/domain/inbox";
import { type UserId, UserIdSchema } from "@packages/domain/user";
import type { StoreEmailBody } from "./store-email-body";

/** Mail to an address that resolves to no user (a guessed/mistyped forwarding
 * address the open inbox still accepts) is recorded under this synthetic
 * partition: an auditable row that never leaks into a real user's list. */
const UNROUTED_USER_ID = UserIdSchema.parse("__unrouted__");

/** The SES "Received" notification SES publishes (via the S3 action's topic) for
 * each inbound message. Only the fields the receive path needs are validated. */
const SesNotificationSchema = z.object({
	mail: z.object({ messageId: z.string().min(1) }),
	receipt: z.object({
		timestamp: z.string().min(1),
		recipients: z.array(z.string()).min(1),
		action: z.object({ objectKey: z.string().min(1) }),
	}),
});

export function initReceiveEmailHandler(deps: {
	readRawEmail: (s3Key: string) => Promise<Buffer | undefined>;
	findByAddress: InboxAddressStore["findByAddress"];
	putEmail: InboxEmailStore["putEmail"];
	parseEmail: (input: { raw: Buffer; receivedAt: string }) => Promise<ParseEmailResult>;
	storeBody: StoreEmailBody;
	publishEvent: PublishEvent;
	logger: HutchLogger;
	maxEmailBytes: number;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { readRawEmail, findByAddress, putEmail, parseEmail, storeBody, publishEvent, logger } =
		deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const notification = SesNotificationSchema.safeParse(JSON.parse(record.body));
				if (!notification.success) {
					logger.error("[receive-email] malformed SES notification", {
						messageId: record.messageId,
					});
					batchItemFailures.push({ itemIdentifier: record.messageId });
					continue;
				}
				const { mail, receipt } = notification.data;
				const s3Key = receipt.action.objectKey;
				const receivedAt = receipt.timestamp;
				const sesMessageId = MessageIdSchema.parse(mail.messageId);

				const raw = await readRawEmail(s3Key);
				if (raw === undefined) {
					// The S3 write can be eventually consistent at receipt; retry.
					logger.warn("[receive-email] raw .eml not yet readable, retrying", { s3Key });
					batchItemFailures.push({ itemIdentifier: record.messageId });
					continue;
				}

				// SES runs the catch-all rule ONCE per message and lists EVERY matching
				// recipient, so one forwarded newsletter can be addressed to several of
				// the domain's forwarding addresses at once — each gets its own row.
				// Non-forwarding `@domain` recipients (postmaster, a typo) are dropped
				// here; the raw .eml kept forever is their audit trail.
				const recipients = receipt.recipients.flatMap((candidate) => {
					const parsed = InboxAddressSchema.safeParse(candidate);
					return parsed.success ? [parsed.data] : [];
				});
				if (recipients.length === 0) {
					// No forwarding recipient — an expected, recurring condition on a public
					// catch-all MX (spam, bots, bounces). The raw .eml is kept; ACK rather
					// than fail to the DLQ so genuine faults don't drown in alert noise.
					logger.warn("[receive-email] no forwarding recipient", {
						messageId: record.messageId,
					});
					continue;
				}

				// Resolve each recipient exactly once so the unrouted-vs-owner partition
				// choice has a single nullish-coalesce that every branch below reuses.
				const resolvedRecipients: {
					recipientAddress: InboxAddress;
					resolved: InboxAddressEntry | undefined;
					userId: UserId;
				}[] = [];
				for (const recipientAddress of recipients) {
					const resolved = await findByAddress(recipientAddress);
					resolvedRecipients.push({
						recipientAddress,
						resolved,
						userId: resolved?.userId ?? UNROUTED_USER_ID,
					});
				}

				const auditRow = (recipientAddress: InboxAddress, userId: UserId): InboxEmailEntry => ({
					userId,
					receivedAtMessageId: `${receivedAt}#${sesMessageId}`,
					messageId: sesMessageId,
					recipientAddress,
					senderEmail: "",
					subject: "",
					status: "rejected",
					receivedAt,
					rawEmailS3Key: s3Key,
					bodyS3Key: undefined,
				});

				if (raw.byteLength > deps.maxEmailBytes) {
					// Oversize is one fact about the whole message: reject every addressed
					// recipient and fail to the DLQ — a real degradation worth paging on.
					logger.error("[receive-email] oversize email rejected", { bytes: raw.byteLength });
					for (const { recipientAddress, userId } of resolvedRecipients) {
						await putEmail(auditRow(recipientAddress, userId));
					}
					batchItemFailures.push({ itemIdentifier: record.messageId });
					continue;
				}

				const parsed = await parseEmail({ raw, receivedAt });
				if (!parsed.ok) {
					// A newsletter that won't parse is a real parser gap (every failure is a
					// user hitting a broken format), so record an audit row per recipient
					// and keep the DLQ page.
					logger.error("[receive-email] unparseable email", { s3Key });
					for (const { recipientAddress, userId } of resolvedRecipients) {
						await putEmail({ ...auditRow(recipientAddress, userId), status: "unparsed" });
					}
					batchItemFailures.push({ itemIdentifier: record.messageId });
					continue;
				}

				const receivedAtMessageId = `${receivedAt}#${parsed.email.messageId}`;
				for (const { recipientAddress, resolved, userId } of resolvedRecipients) {
					if (resolved === undefined) {
						// Unknown address — a guessed/mistyped `in-xxxxxx@`, expected on a
						// public MX. Auditable row under the unrouted partition, then ACK so
						// it never pages the operator.
						logger.warn("[receive-email] unknown recipient", { recipientAddress });
						await putEmail(auditRow(recipientAddress, userId));
						continue;
					}
					if (resolved.disabledAt !== undefined) {
						// The user turned this address off but senders still have it: recurring,
						// not a fault. Auditable row under the owner, then ACK.
						logger.warn("[receive-email] disabled recipient", { recipientAddress });
						await putEmail(auditRow(recipientAddress, userId));
						continue;
					}
					// Body (and its inline images) to S3 BEFORE the row, and the row BEFORE
					// the event: a crash anywhere re-delivers and replays idempotently. The
					// body key is user-scoped so co-addressed recipients never collide.
					const bodyS3Key = await storeBody({
						userId,
						receivedAtMessageId,
						html: parsed.email.html,
						inlineImages: parsed.email.inlineImages,
					});
					const outcome = await putEmail({
						userId,
						receivedAtMessageId,
						messageId: parsed.email.messageId,
						recipientAddress,
						senderEmail: parsed.email.from,
						subject: parsed.email.subject,
						status: "received",
						receivedAt,
						rawEmailS3Key: s3Key,
						bodyS3Key,
					});
					// Re-publish even on a duplicate row: a crash between the row write and
					// the publish would otherwise lose the event. The consumer is
					// idempotent, so a redundant publish is safe.
					await publishEvent(EmailReceivedEvent, {
						userId,
						receivedAtMessageId,
						recipientAddress,
					});
					logger.info("[receive-email] stored", { receivedAtMessageId, outcome });
				}
			} catch (error) {
				logger.error("[receive-email] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
