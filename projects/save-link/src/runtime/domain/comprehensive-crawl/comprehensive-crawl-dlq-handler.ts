import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { initSqsRecordHandler, type PublishEvent } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
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

	return initSqsRecordHandler({
		definition: ComprehensiveCrawlCommand,
		logger,
		failure: { message: "[ComprehensiveCrawlDlq] record failed" },
		malformed: { policy: "retry" },
		handle: async (command, { messageId, receiveCount }) => {
			if (command.candidates !== undefined && command.candidates.length > 0) {
				await publishArchiveComparison({
					url: command.url,
					userId: command.userId,
					recrawl: command.recrawl,
					saveAttemptId: command.saveAttemptId,
					candidates: command.candidates,
					failureReason: { kind: "exhausted-retries", receiveCount },
				});
				logger.error(`[ComprehensiveCrawlDlq] dead-lettered after ${receiveCount} receives (messageId ${messageId}); selecting over stored candidates`, { url: command.url });
				return;
			}

			await transitionAndPersist(markCrawlExhausted, {
				url: command.url,
				input: {
					reason: { kind: "exhausted-retries", receiveCount } as const,
					receiveCount,
				},
			});
			logger.error(`[ComprehensiveCrawlDlq] dead-lettered after ${receiveCount} receives (messageId ${messageId}); marking crawl exhausted`, { url: command.url });
		},
	});
}
