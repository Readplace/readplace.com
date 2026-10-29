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
	type SimpleCrawlUnsupportedDetail,
	ComprehensiveCrawlCommand,
	RenderCrawlCommand,
} from "@packages/hutch-infra-components";

const DEFERRED_CRAWL_COMMANDS = {
	"non-html-content": ComprehensiveCrawlCommand,
	paywall: ComprehensiveCrawlCommand,
	"javascript-required": RenderCrawlCommand,
	unspecified: ComprehensiveCrawlCommand,
} satisfies Record<
	NonNullable<SimpleCrawlUnsupportedDetail["unsupportedReason"]> | "unspecified",
	typeof ComprehensiveCrawlCommand | typeof RenderCrawlCommand
>;

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

				const command = DEFERRED_CRAWL_COMMANDS[detail.unsupportedReason ?? "unspecified"];

				await publishEvent(command, {
					url: detail.url,
					userId: detail.userId,
					recrawl: detail.recrawl,
					refresh: detail.refresh,
					previousBodyHash: detail.previousBodyHash,
					saveAttemptId: detail.saveAttemptId,
					candidates: detail.candidates,
				});

				logger.info(`${logPrefix} dispatched ${command.detailType}`, {
					url: detail.url,
					unsupportedReason: detail.unsupportedReason,
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
