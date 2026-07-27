import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { z } from "zod";
import { CrawlEmailLinkPreview } from "@packages/hutch-infra-components";
import type { HutchLogger } from "@packages/hutch-logger";
import { EmailLinkOrdinalSchema, type InboxEmailLinkStore } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";

const FAILURE_REASON = "preview-retries-exhausted";

const DeadLetteredPreview = CrawlEmailLinkPreview.detailSchema.pipe(
	z.object({
		userId: UserIdSchema,
		receivedAtMessageId: z.string(),
		ordinal: EmailLinkOrdinalSchema,
		url: z.string(),
	}),
);

/**
 * Consumes the `inbox-crawl-email-link-preview` dead-letter queue and turns a
 * `CrawlEmailLinkPreview` that exhausted its receives into the link's terminal
 * `failed` state, so the card settles on "No preview available" instead of
 * spinning for its whole poll budget and then reading as stalled.
 *
 * The write is conditional on the row still being `pending`, which is what makes
 * it safe to run behind a queue whose visibility timeout equals its worker
 * timeout: a slow-but-successful crawl can be redelivered while the first
 * invocation is still finishing, so the copy that lands here may be chasing a
 * link another copy already crawled. `already-terminal` is that race, not a
 * fault.
 *
 * A record whose envelope does not identify a link is ACKed, not retried: this
 * queue is the end of the line, so failing it would replay the same
 * unparseable message forever. It is logged at error level and left to the
 * queue's DLQ alarm.
 */
export function initCrawlEmailLinkPreviewDlqHandler(deps: {
	failPendingLink: InboxEmailLinkStore["failPendingLink"];
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { failPendingLink, logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			const receiveCount = Number(record.attributes.ApproximateReceiveCount);
			try {
				const envelope = JSON.parse(record.body);
				const parsed = DeadLetteredPreview.safeParse(envelope.detail);
				if (!parsed.success) {
					logger.error("[crawl-email-link-preview-dlq] unidentifiable command", {
						messageId: record.messageId,
						receiveCount,
					});
					continue;
				}
				const { userId, receivedAtMessageId, ordinal, url } = parsed.data;

				const outcome = await failPendingLink({
					userId,
					receivedAtMessageId,
					ordinal,
					failureReason: FAILURE_REASON,
				});
				if (outcome === "already-terminal") {
					logger.info("[crawl-email-link-preview-dlq] link already terminal", {
						receivedAtMessageId,
						ordinal,
						receiveCount,
					});
					continue;
				}
				logger.error("[crawl-email-link-preview-dlq] preview gave up", {
					receivedAtMessageId,
					ordinal,
					url,
					receiveCount,
				});
			} catch (error) {
				logger.error("[crawl-email-link-preview-dlq] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
