import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { Logger } from "@packages/logger";
import { initSqsRecordHandler } from "@packages/infra-components/runtime";
import { SummaryGeneratedEvent } from "./index";

export function initSummaryGeneratedHandler(deps: {
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { logger } = deps;

	return initSqsRecordHandler({
		definition: SummaryGeneratedEvent,
		logger,
		failure: { message: "[GlobalSummaryGenerated] record failed" },
		malformed: { policy: "retry" },
		handle: async (detail) => {
			logger.info("[GlobalSummaryGenerated]", {
				url: detail.url,
				inputTokens: detail.inputTokens,
				outputTokens: detail.outputTokens,
			});
		},
	});
}
