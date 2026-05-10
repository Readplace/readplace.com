import type { SQSBatchItemFailure, SQSBatchResponse, SQSHandler } from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import { SummaryGeneratedEvent } from "./index";

export function initSummaryGeneratedHandler(deps: {
	logger: HutchLogger;
}): SQSHandler {
	const { logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = SummaryGeneratedEvent.detailSchema.parse(envelope.detail);

				logger.info("[GlobalSummaryGenerated]", {
					url: detail.url,
					inputTokens: detail.inputTokens,
					outputTokens: detail.outputTokens,
				});
			} catch (error) {
				logger.error("[GlobalSummaryGenerated] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
