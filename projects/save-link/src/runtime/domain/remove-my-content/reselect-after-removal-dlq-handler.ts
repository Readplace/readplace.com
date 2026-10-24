import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { formatErrorLogLine, type HutchLogger } from "@packages/hutch-logger";
import {
	markCrawlExhausted,
	type TransitionAndPersist,
} from "@packages/domain/article-aggregate";
import { ReselectAfterRemovalEvent } from "@packages/hutch-infra-components";

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initReselectAfterRemovalDlqHandler(deps: {
	transitionAndPersist: TransitionAndPersist;
	logger: HutchLogger;
	now: () => Date;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { transitionAndPersist, logger, now } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = ReselectAfterRemovalEvent.detailSchema.parse(envelope.detail);
				const receiveCount = Number(record.attributes.ApproximateReceiveCount);


				await transitionAndPersist(markCrawlExhausted, {
					url: detail.url,
					input: {
						reason: { kind: "exhausted-retries", receiveCount } as const,
						receiveCount,
					},
				});
				logger.error(formatErrorLogLine({
					message: `[ReselectAfterRemovalDlq] dead-lettered after ${receiveCount} receives (messageId ${record.messageId}); marking crawl exhausted`,
					url: detail.url,
					now,
				}));
			} catch (error) {
				logger.error("[ReselectAfterRemovalDlq] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
