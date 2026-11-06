import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { Logger } from "@packages/logger";
import type { TransitionAndPersist } from "@packages/domain/article-aggregate";
import { markCrawlExhausted } from "@packages/domain/article-aggregate";
import { initSqsRecordHandler } from "@packages/infra-components/runtime";
import { SaveAnonymousLinkCommand } from "@packages/infra-components";

interface SaveAnonymousLinkDlqHandlerDeps {
	transitionAndPersist: TransitionAndPersist;
	logger: Logger;
}

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initSaveAnonymousLinkDlqHandler(
	deps: SaveAnonymousLinkDlqHandlerDeps,
): Handler<SQSEvent, SQSBatchResponse> {
	const { transitionAndPersist, logger } = deps;

	return initSqsRecordHandler({
		definition: SaveAnonymousLinkCommand,
		logger,
		failure: { message: "[SaveAnonymousLinkDlq] record failed" },
		malformed: { policy: "retry" },
		handle: async (command, { messageId, receiveCount }) => {
			await transitionAndPersist(markCrawlExhausted, {
				url: command.url,
				input: {
					reason: { kind: "exhausted-retries", receiveCount } as const,
					receiveCount,
				},
			});
			logger.error(`[SaveAnonymousLinkDlq] dead-lettered after ${receiveCount} receives (messageId ${messageId}); marking crawl exhausted`, { url: command.url });
		},
	});
}
