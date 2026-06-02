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
	NotifyReaderViewReadyCommand,
} from "@packages/hutch-infra-components";
import type { DispatchCommand } from "@packages/hutch-infra-components/runtime";
import type {
	FindUserArticlesByUrl,
	MarkReaderViewSucceeded,
} from "@packages/test-fixtures/providers/article-store";

export interface ReaderReadyFanoutDeps {
	findUserArticlesByUrl: FindUserArticlesByUrl;
	markReaderViewSucceeded: MarkReaderViewSucceeded;
	dispatchNotifyReaderViewReady: DispatchCommand<typeof NotifyReaderViewReadyCommand>;
	logger: HutchLogger;
}

export function initReaderReadyFanoutHandler(
	deps: ReaderReadyFanoutDeps,
): Handler<SQSEvent, SQSBatchResponse> {
	const { findUserArticlesByUrl, markReaderViewSucceeded, dispatchNotifyReaderViewReady, logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = z.object({ detail: z.unknown() }).parse(JSON.parse(record.body));
				const detail = ReaderViewLoadingSucceeded.detailSchema.parse(envelope.detail);
				const succeededAt = new Date(detail.succeededAt);

				const savers = await findUserArticlesByUrl(detail.url);
				let dispatched = 0;
				for (const saver of savers) {
					await markReaderViewSucceeded({ userId: saver.userId, url: detail.url, at: succeededAt });
					/* Only savers who actually opened the reader while it was loading
					 * can qualify — never-viewed rows get the succeededAt stamp but no
					 * command, which is what defuses the import storm. A skipped summary
					 * still succeeds the reader view but has nothing to announce. */
					if (detail.hasSummary && saver.viewedAt !== undefined) {
						await dispatchNotifyReaderViewReady({
							userId: saver.userId,
							url: detail.url,
							succeededAt: detail.succeededAt,
						});
						dispatched++;
					}
				}

				logger.info("[ReaderReadyFanout] fanned out reader-view success", {
					url: detail.url,
					hasSummary: detail.hasSummary,
					savers: savers.length,
					dispatched,
				});
			} catch (error) {
				logger.error("[ReaderReadyFanout] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
