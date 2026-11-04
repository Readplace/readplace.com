import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import type { PublishEvent } from "@packages/infra-components/runtime";
import { formatErrorLogLine, type Logger } from "@packages/logger";
import type { TransitionAndPersist } from "@packages/domain/article-aggregate";
import { markCrawlExhausted } from "@packages/domain/article-aggregate";
import { initPublishArchiveComparison } from "../crawl-leg/publish-archive-comparison";
import { ComprehensiveCrawlCommand } from "@packages/infra-components";

interface ComprehensiveCrawlDlqHandlerDeps {
	transitionAndPersist: TransitionAndPersist;
	publishEvent: PublishEvent;
	logger: Logger;
	now: () => Date;
}

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initComprehensiveCrawlDlqHandler(
	deps: ComprehensiveCrawlDlqHandlerDeps,
): Handler<SQSEvent, SQSBatchResponse> {
	const { transitionAndPersist, logger, now } = deps;
	const publishArchiveComparison = initPublishArchiveComparison({ publishEvent: deps.publishEvent, now });

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const command = ComprehensiveCrawlCommand.detailSchema.parse(envelope.detail);
				const receiveCount = Number(record.attributes.ApproximateReceiveCount);

				if (command.candidates !== undefined && command.candidates.length > 0) {
					await publishArchiveComparison({
						url: command.url,
						userId: command.userId,
						recrawl: command.recrawl,
						saveAttemptId: command.saveAttemptId,
						candidates: command.candidates,
						failureReason: { kind: "exhausted-retries", receiveCount },
					});
					logger.error(formatErrorLogLine({
						message: `[ComprehensiveCrawlDlq] dead-lettered after ${receiveCount} receives (messageId ${record.messageId}); selecting over stored candidates`,
						url: command.url,
						now,
					}));
					continue;
				}

				await transitionAndPersist(markCrawlExhausted, {
					url: command.url,
					input: {
						reason: { kind: "exhausted-retries", receiveCount } as const,
						receiveCount,
					},
				});
				logger.error(formatErrorLogLine({
					message: `[ComprehensiveCrawlDlq] dead-lettered after ${receiveCount} receives (messageId ${record.messageId}); marking crawl exhausted`,
					url: command.url,
					now,
				}));
			} catch (error) {
				logger.error("[ComprehensiveCrawlDlq] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
