import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import {
	markSummaryPending,
	type TransitionAndPersist,
} from "@packages/domain/article-aggregate";
import { CanonicalContentChangedEvent } from "@packages/hutch-infra-components";
import type { FindArticleContent } from "../../providers/article-store/find-article-content";

export function initCanonicalContentChangedHandler(deps: {
	findArticleContent: FindArticleContent;
	transitionAndPersist: TransitionAndPersist;
	now: () => Date;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { findArticleContent, transitionAndPersist, now, logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = CanonicalContentChangedEvent.detailSchema.parse(envelope.detail);

				const content = await findArticleContent(detail.url);
				/* Canonical S3 object written upstream may not be readable yet (S3
				 * eventual consistency). Throw so SQS retries through
				 * maxReceiveCount; on exhaustion the DLQ alarm fires. */
				if (!content) {
					throw new Error(`canonical content not yet readable for url=${detail.url}`);
				}

				await transitionAndPersist(markSummaryPending, {
					url: detail.url,
					input: { now: now().toISOString() },
				});

				logger.info("[CanonicalContentChanged] re-primed summary", { url: detail.url });
			} catch (error) {
				logger.error("[CanonicalContentChanged] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
