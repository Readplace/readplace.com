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
	InboxAddressSchema,
	type InboxAddressStore,
	type InboxEmailEntry,
	type InboxEmailStore,
	MessageIdSchema,
	type ParseEmailResult,
} from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
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

				const recipient = InboxAddressSchema.safeParse(receipt.recipients[0]);
				if (!recipient.success) {
					// A non-forwarding `@domain` recipient (postmaster, a typo). The raw
					// .eml is kept forever; surface via DLQ, no user-facing row.
					logger.error("[receive-email] recipient is not a forwarding address", {
						messageId: record.messageId,
					});
					batchItemFailures.push({ itemIdentifier: record.messageId });
					continue;
				}
				const recipientAddress = recipient.data;
				const resolved = await findByAddress(recipientAddress);
				const userId = resolved?.userId ?? UNROUTED_USER_ID;

				const auditRow: InboxEmailEntry = {
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
				};

				if (raw.byteLength > deps.maxEmailBytes) {
					logger.error("[receive-email] oversize email rejected", {
						bytes: raw.byteLength,
						recipientAddress,
					});
					await putEmail(auditRow);
					batchItemFailures.push({ itemIdentifier: record.messageId });
					continue;
				}
				if (resolved === undefined) {
					logger.error("[receive-email] unknown recipient", { recipientAddress });
					await putEmail(auditRow);
					batchItemFailures.push({ itemIdentifier: record.messageId });
					continue;
				}
				if (resolved.disabledAt !== undefined) {
					logger.error("[receive-email] disabled recipient", { recipientAddress });
					await putEmail(auditRow);
					batchItemFailures.push({ itemIdentifier: record.messageId });
					continue;
				}

				const parsed = await parseEmail({ raw, receivedAt });
				if (!parsed.ok) {
					logger.error("[receive-email] unparseable email", { s3Key });
					await putEmail({ ...auditRow, status: "unparsed" });
					batchItemFailures.push({ itemIdentifier: record.messageId });
					continue;
				}

				const receivedAtMessageId = `${receivedAt}#${parsed.email.messageId}`;
				// Body (and its inline images) to S3 BEFORE the row, and the row BEFORE
				// the event: a crash anywhere re-delivers and replays idempotently.
				const bodyS3Key = await storeBody({
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
