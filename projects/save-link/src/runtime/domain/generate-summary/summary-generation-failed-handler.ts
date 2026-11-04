import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { Logger } from "@packages/logger";
import { initSqsRecordHandler } from "@packages/infra-components/runtime";
import {
	PARSE_ERROR_STREAM,
	type ParseErrorEvent,
} from "@packages/infra-components";
import { SummaryGenerationFailedEvent } from "./index";

export function initSummaryGenerationFailedHandler(deps: {
	parseErrorLogger: Logger.Typed<ParseErrorEvent>;
	logger: Logger;
	now: () => Date;
}): Handler<SQSEvent, SQSBatchResponse> {
	return initSqsRecordHandler({
		definition: SummaryGenerationFailedEvent,
		logger: deps.logger,
		failure: { message: "[SummaryGenerationFailed] record failed" },
		malformed: { policy: "retry" },
		handle: async (detail) => {
			deps.parseErrorLogger.info({
				stream: PARSE_ERROR_STREAM,
				event: "parse-failure",
				timestamp: deps.now().toISOString(),
				url: detail.url,
				reason: `summary-generation-failed: ${detail.reason} (receiveCount=${detail.receiveCount})`,
				source: "generate-summary",
			});
		},
	});
}
