import type { SQSBatchItemFailure, SQSBatchResponse, SQSHandler } from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import {
	CrawlArticleFailedEvent,
	TierContentExtractedEvent,
} from "@packages/hutch-infra-components";
import type { MarkCrawlFailed } from "../crawl-article-state/article-crawl.types";
import type { MarkSummaryFailed } from "../generate-summary/article-summary.types";

interface SelectMostCompleteContentDlqHandlerDeps {
	markCrawlFailed: MarkCrawlFailed;
	markSummaryFailed: MarkSummaryFailed;
	publishEvent: PublishEvent;
	logger: HutchLogger;
}

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initSelectMostCompleteContentDlqHandler(
	deps: SelectMostCompleteContentDlqHandlerDeps,
): SQSHandler {
	const { markCrawlFailed, markSummaryFailed, publishEvent, logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = TierContentExtractedEvent.detailSchema.parse(envelope.detail);
				const receiveCount = Number(record.attributes.ApproximateReceiveCount);
				const reason = "exceeded SQS maxReceiveCount";

				logger.info("[SelectMostCompleteContentDlq] marking crawl failed", {
					url: detail.url,
					tier: detail.tier,
					receiveCount,
				});

				await markCrawlFailed({ url: detail.url, reason });
				await markSummaryFailed({ url: detail.url, reason: "crawl failed" });

				await publishEvent({
					source: CrawlArticleFailedEvent.source,
					detailType: CrawlArticleFailedEvent.detailType,
					detail: JSON.stringify({ url: detail.url, reason, receiveCount }),
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
