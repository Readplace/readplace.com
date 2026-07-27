import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import type { InboxEmailLinkStore } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { EmailReceivedEvent } from "@packages/hutch-infra-components";

/**
 * Turns a dead-lettered extraction into the barrier that says it gave up, so the
 * Articles panel stops polling and tells the reader the scan failed.
 *
 * Writing an ordinary barrier here would be worse than writing nothing: with no
 * link rows behind it the panel reads meta-present-with-zero-rows as the terminal
 * "No links found in this email." — a claim about an email nobody managed to
 * read. The marker keeps the barrier's terminality and swaps the message.
 *
 * The write is conditional on no barrier existing. Delivery is at-least-once, so
 * one attempt can succeed while a duplicate exhausts its receives; overwriting
 * that success would paint a permanent failure over a real card set. Losing the
 * race the other way is self-healing — the successful run's unconditional barrier
 * lands moments later and replaces this one.
 */
export function initExtractEmailLinksDlqHandler(deps: {
	markLinksExtractionFailed: InboxEmailLinkStore["markLinksExtractionFailed"];
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { markLinksExtractionFailed, logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const received = EmailReceivedEvent.detailSchema.parse(envelope.detail);
				const userId = UserIdSchema.parse(received.userId);
				const { receivedAtMessageId } = received;
				const receiveCount = Number(record.attributes.ApproximateReceiveCount);

				const outcome = await markLinksExtractionFailed({ userId, receivedAtMessageId });

				logger.info("[ExtractEmailLinksDlq] extraction gave up", {
					receivedAtMessageId,
					receiveCount,
					outcome,
				});
			} catch (error) {
				logger.error("[ExtractEmailLinksDlq] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
