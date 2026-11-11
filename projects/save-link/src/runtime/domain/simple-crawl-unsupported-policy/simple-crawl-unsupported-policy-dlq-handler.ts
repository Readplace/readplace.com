import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { initSqsRecordHandler, type PublishEvent } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
import type { TransitionAndPersist } from "@packages/domain/article-aggregate";
import { markCrawlExhausted } from "@packages/domain/article-aggregate";
import { initPublishArchiveComparison } from "../crawl-leg/publish-archive-comparison";
import { DeadLetteredDeferredCrawl } from "../crawl-leg/dead-lettered-deferred-crawl";

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initSimpleCrawlUnsupportedPolicyDlqHandler(
	deps: {
		transitionAndPersist: TransitionAndPersist;
		publishEvent: PublishEvent;
		logger: Logger;
		now: () => Date;
	},
): Handler<SQSEvent, SQSBatchResponse> {
	const { transitionAndPersist, logger, now } = deps;
	const publishArchiveComparison = initPublishArchiveComparison({ publishEvent: deps.publishEvent, now });

	return initSqsRecordHandler({
		definition: DeadLetteredDeferredCrawl,
		logger,
		failure: { message: "[SimpleCrawlUnsupportedPolicyDlq] record failed" },
		malformed: { policy: "retry" },
		handle: async (detail, { messageId, receiveCount }) => {
			if (detail.candidates !== undefined && detail.candidates.length > 0) {
				await publishArchiveComparison({
					url: detail.url,
					userId: detail.userId,
					recrawl: detail.trigger === "recrawl",
					saveAttemptId: detail.saveAttemptId,
					candidates: detail.candidates,
					failureReason: { kind: "exhausted-retries", receiveCount },
				});
				logger.error(`[SimpleCrawlUnsupportedPolicyDlq] dead-lettered after ${receiveCount} receives (messageId ${messageId}); selecting over stored candidates`, { url: detail.url });
				return;
			}

			await transitionAndPersist(markCrawlExhausted, {
				url: detail.url,
				input: {
					reason: { kind: "exhausted-retries", receiveCount } as const,
					receiveCount,
				},
			});
			logger.error(`[SimpleCrawlUnsupportedPolicyDlq] dead-lettered after ${receiveCount} receives (messageId ${messageId}); marking crawl exhausted`, { url: detail.url });
		},
	});
}
