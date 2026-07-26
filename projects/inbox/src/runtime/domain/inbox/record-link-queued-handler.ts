import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { LinkQueueFailedEvent, LinkQueuedEvent } from "@packages/hutch-infra-components";
import type { HutchLogger } from "@packages/hutch-logger";
import type { InboxSavedLinkStore } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";

/**
 * Maintains the per-user saved-link read model the Articles tab renders its
 * Saved button from. One Lambda behind two queues — `LinkQueuedEvent` (a save
 * reached its terminal accept state) and `LinkQueueFailedEvent` (it exhausted
 * its accept retries) — dispatched on the envelope's detail-type.
 *
 * Both writes are unconditional upserts, because both facts are re-published on
 * SQS redelivery and on every re-save of the same link. A URL the key derivation
 * cannot parse fails the record to the DLQ: the producer only ever publishes URLs
 * that already passed `validateSaveableUrl`, so an unparseable one is a contract
 * violation worth paging on, not a link to skip.
 */
export function initRecordLinkQueuedHandler(deps: {
	markLinkSaved: InboxSavedLinkStore["markLinkSaved"];
	markLinkSaveFailed: InboxSavedLinkStore["markLinkSaveFailed"];
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { markLinkSaved, markLinkSaveFailed, logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const failed = envelope["detail-type"] === LinkQueueFailedEvent.detailType;
				const schema = failed
					? LinkQueueFailedEvent.detailSchema
					: LinkQueuedEvent.detailSchema;
				const parsed = schema.safeParse(envelope.detail);
				if (!parsed.success) {
					logger.error("[record-link-queued] malformed event", {
						messageId: record.messageId,
						detailType: envelope["detail-type"],
					});
					batchItemFailures.push({ itemIdentifier: record.messageId });
					continue;
				}
				const userId = UserIdSchema.parse(parsed.data.userId);
				const { url } = parsed.data;

				if (failed) {
					await markLinkSaveFailed({ userId, url });
					logger.info("[record-link-queued] save failed", { url });
					continue;
				}
				await markLinkSaved({ userId, url });
				logger.info("[record-link-queued] save accepted", { url });
			} catch (error) {
				logger.error("[record-link-queued] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
