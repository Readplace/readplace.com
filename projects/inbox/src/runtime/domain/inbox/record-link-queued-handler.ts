import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import {
	LinkDequeuedEvent,
	LinkQueueFailedEvent,
	LinkQueuedEvent,
} from "@packages/infra-components";
import type { Logger } from "@packages/logger";
import type { InboxSavedLinkStore } from "@packages/domain/inbox";
import type { FindQueueRowKeys } from "@packages/provider-contracts/article-store";
import type { RecordLinkFact } from "./record-queued-link";
import { UserIdSchema } from "@packages/domain/user";
import { z } from "zod";

/** Every fact this handler records names one link in one reader's queue. The
 * failure fact carries diagnostics past these two, which this read model does
 * not store — so what it records is one shape, whichever fact carried it. */
const LinkFactSchema = z.object({ url: z.string(), userId: UserIdSchema });

/**
 * Maintains the per-user saved-link read model both tabs render their save
 * button from. One Lambda behind one queue per fact — a save reached its
 * terminal accept state, it exhausted its accept retries, or the reader deleted
 * the queue row a save produced — dispatched on the envelope's detail-type.
 *
 * A URL the key derivation
 * cannot parse fails the record to the DLQ: the producer only ever publishes URLs
 * that already passed `validateSaveableUrl`, so an unparseable one is a contract
 * violation worth paging on, not a link to skip. A detail-type no rule delivers
 * fails the same way rather than defaulting to one of the three — defaulting is
 * how a deletion would be recorded as a save.
 */
export function initRecordLinkQueuedHandler(deps: {
	recordQueuedLink: RecordLinkFact;
	recordFailedLink: RecordLinkFact;
	retractLinkSaved: InboxSavedLinkStore["retractLinkSaved"];
	findQueueRowKeys: FindQueueRowKeys;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { recordQueuedLink, recordFailedLink, retractLinkSaved, findQueueRowKeys, logger } = deps;

	const retractUnlessStillQueued: RecordLinkFact = async ({ userId, url }) => {
		const keys = await findQueueRowKeys({ userId, urls: [url] });
		if (keys.length > 0) return "retraction skipped: link still in queue";
		await retractLinkSaved({ userId, url });
		return "save retracted";
	};

	const recorders: Record<string, RecordLinkFact> = {
		[LinkQueuedEvent.detailType]: recordQueuedLink,
		[LinkQueueFailedEvent.detailType]: recordFailedLink,
		[LinkDequeuedEvent.detailType]: retractUnlessStillQueued,
	};

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detailType = envelope["detail-type"];
				const recorder = recorders[detailType];
				const parsed = LinkFactSchema.safeParse(envelope.detail);
				if (recorder === undefined || !parsed.success) {
					logger.error("[record-link-queued] malformed event", {
						messageId: record.messageId,
						detailType,
					});
					batchItemFailures.push({ itemIdentifier: record.messageId });
					continue;
				}
				const outcome = await recorder(parsed.data);
				logger.info(`[record-link-queued] ${outcome}`, {
					url: parsed.data.url,
					userId: parsed.data.userId,
					messageId: record.messageId,
				});
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
