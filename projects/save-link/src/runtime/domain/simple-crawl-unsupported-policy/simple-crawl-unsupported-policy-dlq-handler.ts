import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import type { TransitionAndPersist } from "@packages/domain/article-aggregate";
import { markCrawlExhausted } from "@packages/domain/article-aggregate";
import { SimpleCrawlUnsupportedEvent } from "@packages/hutch-infra-components";

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initSimpleCrawlUnsupportedPolicyDlqHandler(
	deps: {
		transitionAndPersist: TransitionAndPersist;
		logger: HutchLogger;
	},
): Handler<SQSEvent, SQSBatchResponse> {
	const { transitionAndPersist, logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = SimpleCrawlUnsupportedEvent.detailSchema.parse(envelope.detail);
				const receiveCount = Number(record.attributes.ApproximateReceiveCount);

				logger.info("[SimpleCrawlUnsupportedPolicyDlq] marking crawl exhausted", {
					url: detail.url,
					receiveCount,
				});

				await transitionAndPersist(markCrawlExhausted, {
					url: detail.url,
					input: {
						reason: { kind: "exhausted-retries", receiveCount } as const,
						receiveCount,
					},
				});
			} catch (error) {
				logger.error("[SimpleCrawlUnsupportedPolicyDlq] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
