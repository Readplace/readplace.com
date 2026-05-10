import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import {
	CrawlArticleFailedEvent,
	RecrawlLinkInitiatedEvent,
} from "@packages/hutch-infra-components";
import type { MarkCrawlFailed } from "./article-crawl.types";
import type { MarkSummaryFailed } from "../generate-summary/article-summary.types";

interface RecrawlLinkInitiatedDlqHandlerDeps {
	markCrawlFailed: MarkCrawlFailed;
	markSummaryFailed: MarkSummaryFailed;
	publishEvent: PublishEvent;
	logger: HutchLogger;
}

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initRecrawlLinkInitiatedDlqHandler(
	deps: RecrawlLinkInitiatedDlqHandlerDeps,
): Handler<SQSEvent, SQSBatchResponse> {
	const { markCrawlFailed, markSummaryFailed, publishEvent, logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = RecrawlLinkInitiatedEvent.detailSchema.parse(envelope.detail);
				const receiveCount = Number(record.attributes.ApproximateReceiveCount);
				const reason = "exceeded SQS maxReceiveCount";

				logger.info("[RecrawlLinkInitiatedDlq] marking crawl failed", {
					url: detail.url,
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
				logger.error("[RecrawlLinkInitiatedDlq] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
