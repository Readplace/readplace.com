import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { LinkQueueFailedEvent, SubmitLinkCommand } from "@packages/hutch-infra-components";

const REASON = "accept-retries-exhausted";

/**
 * Turns a dead-lettered `SubmitLinkCommand` into the fact that the save gave up,
 * so a reader's saved-link read model is not left claiming a queue row that was
 * never written.
 *
 * The fact is weaker than it looks and its consumers must treat it that way: the
 * accept phase writes the reader's queue row *first* and several calls after it
 * can still throw, so a record can exhaust its receives with the article sitting
 * in the queue the whole time. This says "the command gave up", not "nothing was
 * queued" — which is why the read model lets an existing accepted save outrank it.
 *
 * Mutates no article row, deliberately: the row either does not exist or belongs
 * to another saver's in-flight crawl. Publishing the fact is the whole job.
 *
 * A command with no `userId` (the reserved anonymous shapes, which the accept
 * handler already refuses) has no per-user read model to correct. It is logged
 * at error level and left to the DLQ alarm rather than being forced into a fact
 * whose `userId` is the one thing it cannot supply.
 */
export function initSubmitLinkDlqHandler(deps: {
	publishEvent: PublishEvent;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { publishEvent, logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const command = SubmitLinkCommand.detailSchema.parse(envelope.detail);
				const receiveCount = Number(record.attributes.ApproximateReceiveCount);

				if (command.userId === undefined) {
					logger.error("[SubmitLinkDlq] dead letter with no userId", {
						url: command.url,
						receiveCount,
					});
					continue;
				}

				logger.info("[SubmitLinkDlq] publishing save failure", {
					url: command.url,
					receiveCount,
				});
				await publishEvent(LinkQueueFailedEvent, {
					url: command.url,
					userId: command.userId,
					reason: REASON,
					receiveCount,
				});
			} catch (error) {
				logger.error("[SubmitLinkDlq] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
