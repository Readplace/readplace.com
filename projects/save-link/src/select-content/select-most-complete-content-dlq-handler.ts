import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import {
	markCrawlExhausted,
	type TransitionAndPersist,
} from "@packages/domain/article-aggregate";
import { TierContentExtractedEvent } from "@packages/hutch-infra-components";

interface SelectMostCompleteContentDlqHandlerDeps {
	transitionAndPersist: TransitionAndPersist;
	logger: HutchLogger;
}

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initSelectMostCompleteContentDlqHandler(
	deps: SelectMostCompleteContentDlqHandlerDeps,
): Handler<SQSEvent, SQSBatchResponse> {
	const { transitionAndPersist, logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = TierContentExtractedEvent.detailSchema.parse(envelope.detail);
				const receiveCount = Number(record.attributes.ApproximateReceiveCount);
				const reason = "exceeded SQS maxReceiveCount";

				logger.info("[SelectMostCompleteContentDlq] marking crawl exhausted", {
					url: detail.url,
					tier: detail.tier,
					receiveCount,
				});

				await transitionAndPersist(markCrawlExhausted, {
					url: detail.url,
					input: { reason, receiveCount },
				});
			} catch (error) {
				logger.error("[SelectMostCompleteContentDlq] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
