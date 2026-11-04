import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { Logger } from "@packages/logger";
import type { TransitionAndPersist } from "@packages/domain/article-aggregate";
import { markCrawlExhausted } from "@packages/domain/article-aggregate";
import { RecrawlLinkInitiatedEvent } from "@packages/infra-components";
import { initSqsRecordHandler } from "@packages/infra-components/runtime";

interface RecrawlLinkInitiatedDlqHandlerDeps {
	transitionAndPersist: TransitionAndPersist;
	logger: Logger;
}

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initRecrawlLinkInitiatedDlqHandler(
	deps: RecrawlLinkInitiatedDlqHandlerDeps,
): Handler<SQSEvent, SQSBatchResponse> {
	const { transitionAndPersist, logger } = deps;

	return initSqsRecordHandler({
		definition: { detailSchema: RecrawlLinkInitiatedEvent.detailSchema.pick({ url: true }) },
		logger,
		malformed: { policy: "retry" },
		failure: {
			report: ({ record, error, detail }) =>
				logger.error("[RecrawlLinkInitiatedDlq] record failed", {
					messageId: record.messageId,
					url: detail?.url,
					error,
				}),
		},
		handle: async (detail, { messageId, receiveCount }) => {
			await transitionAndPersist(markCrawlExhausted, {
				url: detail.url,
				input: {
					reason: { kind: "exhausted-retries", receiveCount } as const,
					receiveCount,
				},
			});
			logger.error(
				`[RecrawlLinkInitiatedDlq] dead-lettered after ${receiveCount} receives (messageId ${messageId}); marking crawl exhausted`,
				{ url: detail.url },
			);
		},
	});
}
