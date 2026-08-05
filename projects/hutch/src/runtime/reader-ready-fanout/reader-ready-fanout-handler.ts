import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { z } from "zod";
import type { HutchLogger } from "@packages/hutch-logger";
import { ReaderViewLoadingSucceeded } from "@packages/hutch-infra-components";
import type { FindUserArticlesByUrl } from "@packages/provider-contracts/article-store";
import type { EnqueueDigestItem } from "@packages/provider-contracts/digest-queue";

export interface ReaderReadyUsersNotificationFanoutDeps {
	findUserArticlesByUrl: FindUserArticlesByUrl;
	enqueueDigestItem: EnqueueDigestItem;
	/** TTL retention applied to each enqueued digest row (safety purge). */
	digestRetentionMs: number;
	now: () => Date;
	logger: HutchLogger;
}

export function initReaderReadyUsersNotificationFanoutHandler(
	deps: ReaderReadyUsersNotificationFanoutDeps,
): Handler<SQSEvent, SQSBatchResponse> {
	const { findUserArticlesByUrl, enqueueDigestItem, digestRetentionMs, now, logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = z.object({ detail: z.unknown() }).parse(JSON.parse(record.body));
				const detail = ReaderViewLoadingSucceeded.detailSchema.parse(envelope.detail);

				const savers = await findUserArticlesByUrl(detail.url);
				/* Only savers who opened the reader can qualify — never-viewed rows are
				 * not enqueued at all, which is what defuses the import storm. A skipped
				 * summary still succeeds the reader view but has nothing to announce.
				 * Whether the open was *early enough* is decided at send time against
				 * the article's readerAvailableAt, not here. */
				const eligible = detail.hasSummary
					? savers.filter((saver) => saver.viewedAt !== undefined)
					: [];
				await Promise.all(
					eligible.map((saver) =>
						enqueueDigestItem({
							userId: saver.userId,
							url: detail.url,
							enqueuedAt: now().toISOString(),
							retentionMs: digestRetentionMs,
						}),
					),
				);

				logger.info("[ReaderReadyUsersNotificationFanout] fanned out reader-view success", {
					url: detail.url,
					hasSummary: detail.hasSummary,
					succeededAt: detail.succeededAt,
					savers: savers.length,
					enqueued: eligible.length,
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
