import type { SQSBatchItemFailure, SQSBatchResponse, SQSHandler } from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import {
	CrawlArticleFailedEvent,
	SaveAnonymousLinkCommand,
} from "@packages/hutch-infra-components";
import type { MarkCrawlFailed } from "./article-crawl.types";
import type { MarkSummaryFailed } from "../generate-summary/article-summary.types";

interface SaveAnonymousLinkDlqHandlerDeps {
	markCrawlFailed: MarkCrawlFailed;
	markSummaryFailed: MarkSummaryFailed;
	publishEvent: PublishEvent;
	logger: HutchLogger;
}

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initSaveAnonymousLinkDlqHandler(
	deps: SaveAnonymousLinkDlqHandlerDeps,
): SQSHandler {
	const { markCrawlFailed, markSummaryFailed, publishEvent, logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const command = SaveAnonymousLinkCommand.detailSchema.parse(envelope.detail);
				const receiveCount = Number(record.attributes.ApproximateReceiveCount);
				const reason = "exceeded SQS maxReceiveCount";

				logger.info("[SaveAnonymousLinkDlq] marking crawl failed", {
					url: command.url,
					receiveCount,
				});

				await markCrawlFailed({ url: command.url, reason });
				await markSummaryFailed({ url: command.url, reason: "crawl failed" });

				await publishEvent({
					source: CrawlArticleFailedEvent.source,
					detailType: CrawlArticleFailedEvent.detailType,
					detail: JSON.stringify({ url: command.url, reason, receiveCount }),
				});
			} catch (error) {
				logger.error("[SaveAnonymousLinkDlq] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
