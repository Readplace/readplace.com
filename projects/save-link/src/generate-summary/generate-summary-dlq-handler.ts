import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import {
	GenerateSummaryCommand,
	SummaryGenerationFailedEvent,
} from "./index";
import type { MarkSummaryFailed } from "./article-summary.types";

interface GenerateSummaryDlqHandlerDeps {
	markSummaryFailed: MarkSummaryFailed;
	publishEvent: PublishEvent;
	logger: HutchLogger;
}

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initGenerateSummaryDlqHandler(deps: GenerateSummaryDlqHandlerDeps): Handler<SQSEvent, SQSBatchResponse> {
	const { markSummaryFailed, publishEvent, logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const command = GenerateSummaryCommand.detailSchema.parse(envelope.detail);
				const receiveCount = Number(record.attributes.ApproximateReceiveCount);
				const reason = "exceeded SQS maxReceiveCount";

				logger.info("[GenerateSummaryDlq] marking failed", { url: command.url, receiveCount });

				await markSummaryFailed({ url: command.url, reason });

				await publishEvent({
					source: SummaryGenerationFailedEvent.source,
					detailType: SummaryGenerationFailedEvent.detailType,
					detail: JSON.stringify({ url: command.url, reason, receiveCount }),
				});
			} catch (error) {
				logger.error("[GenerateSummaryDlq] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
