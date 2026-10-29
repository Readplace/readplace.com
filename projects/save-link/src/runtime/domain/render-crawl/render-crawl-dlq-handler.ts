import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { formatErrorLogLine, type HutchLogger } from "@packages/hutch-logger";
import type { TransitionAndPersist } from "@packages/domain/article-aggregate";
import { markCrawlExhausted } from "@packages/domain/article-aggregate";
import { RenderCrawlCommand } from "@packages/hutch-infra-components";

interface RenderCrawlDlqHandlerDeps {
	transitionAndPersist: TransitionAndPersist;
	logger: HutchLogger;
	now: () => Date;
}

export function initRenderCrawlDlqHandler(
	deps: RenderCrawlDlqHandlerDeps,
): Handler<SQSEvent, SQSBatchResponse> {
	const { transitionAndPersist, logger, now } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const command = RenderCrawlCommand.detailSchema.parse(envelope.detail);
				const receiveCount = Number(record.attributes.ApproximateReceiveCount);

				await transitionAndPersist(markCrawlExhausted, {
					url: command.url,
					input: {
						reason: { kind: "exhausted-retries", receiveCount } as const,
						receiveCount,
					},
				});
				logger.error(formatErrorLogLine({
					message: `[RenderCrawlDlq] dead-lettered after ${receiveCount} receives (messageId ${record.messageId}); marking crawl exhausted`,
					url: command.url,
					now,
				}));
			} catch (error) {
				logger.error("[RenderCrawlDlq] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
