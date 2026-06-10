import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import {
	SimpleCrawlUnsupportedEvent,
	ComprehensiveCrawlCommand,
} from "@packages/hutch-infra-components";

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initSimpleCrawlUnsupportedPolicyHandler(deps: {
	publishEvent: PublishEvent;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { publishEvent, logger } = deps;
	const logPrefix = "[SimpleCrawlUnsupportedPolicy]";

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = SimpleCrawlUnsupportedEvent.detailSchema.parse(envelope.detail);

				await publishEvent(ComprehensiveCrawlCommand, {
					url: detail.url,
					userId: detail.userId,
					recrawl: detail.recrawl,
					refresh: detail.refresh,
					previousBodyHash: detail.previousBodyHash,
				});

				logger.info(`${logPrefix} dispatched ComprehensiveCrawlCommand`, {
					url: detail.url,
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
