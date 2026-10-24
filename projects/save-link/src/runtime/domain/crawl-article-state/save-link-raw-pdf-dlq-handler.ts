import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { formatErrorLogLine, type HutchLogger } from "@packages/hutch-logger";
import type { TransitionAndPersist } from "@packages/domain/article-aggregate";
import { markCrawlExhausted } from "@packages/domain/article-aggregate";
import { SaveLinkRawPdfCommand } from "@packages/hutch-infra-components";

interface SaveLinkRawPdfDlqHandlerDeps {
	transitionAndPersist: TransitionAndPersist;
	logger: HutchLogger;
	now: () => Date;
}

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initSaveLinkRawPdfDlqHandler(
	deps: SaveLinkRawPdfDlqHandlerDeps,
): Handler<SQSEvent, SQSBatchResponse> {
	const { transitionAndPersist, logger, now } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const command = SaveLinkRawPdfCommand.detailSchema.parse(envelope.detail);
				const receiveCount = Number(record.attributes.ApproximateReceiveCount);


				await transitionAndPersist(markCrawlExhausted, {
					url: command.url,
					input: {
						reason: { kind: "exhausted-retries", receiveCount } as const,
						receiveCount,
					},
				});
				logger.error(formatErrorLogLine({
					message: `[SaveLinkRawPdfDlq] dead-lettered after ${receiveCount} receives (messageId ${record.messageId}); marking crawl exhausted`,
					url: command.url,
					now,
				}));
			} catch (error) {
				logger.error("[SaveLinkRawPdfDlq] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
