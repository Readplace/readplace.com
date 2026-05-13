import type {
	RefreshContentInput,
	TransitionAndPersist,
} from "@packages/domain/article-aggregate";
import { refreshContent } from "@packages/domain/article-aggregate";
import type { HutchLogger } from "@packages/hutch-logger";
import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { RefreshArticleContentCommand } from "./index";

export function initRefreshArticleContentHandler(deps: {
	transitionAndPersist: TransitionAndPersist;
	now: () => Date;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { transitionAndPersist, now, logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = RefreshArticleContentCommand.detailSchema.parse(envelope.detail);

				logger.info("[RefreshArticleContent] processing", { url: detail.url });

				const input: RefreshContentInput = {
					metadata: detail.metadata,
					freshness: {
						etag: detail.etag,
						lastModified: detail.lastModified,
						contentFetchedAt: detail.contentFetchedAt,
					},
					estimatedReadTime: detail.estimatedReadTime,
					now: now().toISOString(),
				};

				/**
				 * 1. transitionAndPersist enforces save → dispatch order: the row
				 *    flips to summaryStatus=pending in DDB before the
				 *    GenerateSummaryCommand fires. The summary worker
				 *    short-circuits on cached `ready` rows, so dispatching first
				 *    would let a fast worker read the stale cache and skip the
				 *    regen — exactly the race the previous handler guarded
				 *    against by ordering refresh → dispatch in the handler body.
				 *
				 * 2. The aggregate's refreshContent transition pairs the
				 *    summary-state reset with the generate-summary effect, so a
				 *    future writer can't drop the regen command — that omission
				 *    fails the transition's unit test rather than producing the
				 *    forever-pending row from 2026-05-10.
				 */
				await transitionAndPersist(refreshContent, {
					url: detail.url,
					input,
				});

				logger.info("[RefreshArticleContent] completed", { url: detail.url });
			} catch (error) {
				logger.error("[RefreshArticleContent] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
