import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import type { Logger } from "@packages/logger";
import type { PublishEvent } from "@packages/infra-components/runtime";
import {
	SimpleCrawlUnsupportedEvent,
	ComprehensiveCrawlCommand,
	RenderCrawlCommand,
} from "@packages/infra-components";

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initSimpleCrawlUnsupportedPolicyHandler(deps: {
	publishEvent: PublishEvent;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { publishEvent, logger } = deps;
	const logPrefix = "[SimpleCrawlUnsupportedPolicy]";

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = SimpleCrawlUnsupportedEvent.detailSchema.parse(envelope.detail);

				const { unsupportedReason } = detail;
				const needsRender = unsupportedReason === "javascript-required" || unsupportedReason === "blocked";
				const forwarded = {
					url: detail.url,
					userId: detail.userId,
					recrawl: detail.recrawl,
					refresh: detail.refresh,
					previousBodyHash: detail.previousBodyHash,
					saveAttemptId: detail.saveAttemptId,
					candidates: detail.candidates,
				};
				if (needsRender) await publishEvent(RenderCrawlCommand, { ...forwarded, unsupportedReason, finalUrl: detail.finalUrl });
				else await publishEvent(ComprehensiveCrawlCommand, forwarded);
				const command = needsRender ? RenderCrawlCommand : ComprehensiveCrawlCommand;

				logger.info(`${logPrefix} dispatched ${command.detailType}`, {
					url: detail.url,
					unsupportedReason,
					recrawl: detail.recrawl ? 1 : 0,
					refresh: detail.refresh ? 1 : 0,
				});
			} catch (error) {
				logger.error(`${logPrefix} record failed`, {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
