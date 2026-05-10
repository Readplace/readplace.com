import type { SQSBatchItemFailure, SQSBatchResponse, SQSHandler } from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import {
	PARSE_ERROR_STREAM,
	type ParseErrorEvent,
} from "@packages/hutch-infra-components";
import { SummaryGenerationFailedEvent } from "./index";

export function initSummaryGenerationFailedHandler(deps: {
	parseErrorLogger: HutchLogger.Typed<ParseErrorEvent>;
	logger: HutchLogger;
	now: () => Date;
}): SQSHandler {
	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = SummaryGenerationFailedEvent.detailSchema.parse(envelope.detail);

				deps.parseErrorLogger.info({
					stream: PARSE_ERROR_STREAM,
					event: "parse-failure",
					timestamp: deps.now().toISOString(),
					url: detail.url,
					reason: `summary-generation-failed: ${detail.reason} (receiveCount=${detail.receiveCount})`,
					source: "generate-summary",
				});
			} catch (error) {
				deps.logger.error("[SummaryGenerationFailed] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
