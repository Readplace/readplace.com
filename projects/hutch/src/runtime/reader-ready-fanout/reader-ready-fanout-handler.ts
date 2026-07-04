import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { z } from "zod";
import type { HutchLogger } from "@packages/hutch-logger";
import { ReaderViewLoadingSucceeded } from "@packages/hutch-infra-components";
import type {
	FindUserArticlesByUrl,
	MarkReaderViewSucceeded,
} from "@packages/provider-contracts/article-store";
import type { EnqueueDigestItem } from "@packages/provider-contracts/digest-queue";

export interface ReaderReadyUsersNotificationFanoutDeps {
	findUserArticlesByUrl: FindUserArticlesByUrl;
	markReaderViewSucceeded: MarkReaderViewSucceeded;
	enqueueDigestItem: EnqueueDigestItem;
	/** TTL retention applied to each enqueued digest row (safety purge). */
	digestRetentionMs: number;
	now: () => Date;
	logger: HutchLogger;
}

export function initReaderReadyUsersNotificationFanoutHandler(
	deps: ReaderReadyUsersNotificationFanoutDeps,
): Handler<SQSEvent, SQSBatchResponse> {
	const { findUserArticlesByUrl, markReaderViewSucceeded, enqueueDigestItem, digestRetentionMs, now, logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = z.object({ detail: z.unknown() }).parse(JSON.parse(record.body));
				const detail = ReaderViewLoadingSucceeded.detailSchema.parse(envelope.detail);
				const succeededAt = new Date(detail.succeededAt);

				const savers = await findUserArticlesByUrl(detail.url);
				const results = await Promise.all(savers.map(async (saver) => {
					await markReaderViewSucceeded({ userId: saver.userId, url: detail.url, at: succeededAt });
					/* Only savers who actually opened the reader while it was loading
					 * can qualify — never-viewed rows get the succeededAt stamp but no
					 * digest entry, which is what defuses the import storm. A skipped
					 * summary still succeeds the reader view but has nothing to announce. */
					if (detail.hasSummary && saver.viewedAt !== undefined) {
						await enqueueDigestItem({
							userId: saver.userId,
							url: detail.url,
							enqueuedAt: now().toISOString(),
							retentionMs: digestRetentionMs,
						});
						return true;
					}
					return false;
				}));

				logger.info("[ReaderReadyUsersNotificationFanout] fanned out reader-view success", {
					url: detail.url,
					hasSummary: detail.hasSummary,
					savers: savers.length,
					enqueued: results.filter(Boolean).length,
				});
			} catch (error) {
				logger.error("[ReaderReadyUsersNotificationFanout] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
