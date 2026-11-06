import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { Logger } from "@packages/logger";
import { initSqsRecordHandler } from "@packages/infra-components/runtime";
import { UpdateFetchTimestampCommand } from "./index";

export type UpdateFetchTimestamp = (params: {
	url: string;
	contentFetchedAt: string;
	etag?: string;
	lastModified?: string;
	bodyHash?: string;
}) => Promise<void>;

export function initUpdateFetchTimestampHandler(deps: {
	updateFetchTimestamp: UpdateFetchTimestamp;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { updateFetchTimestamp, logger } = deps;

	return initSqsRecordHandler({
		definition: UpdateFetchTimestampCommand,
		logger,
		failure: { message: "[UpdateFetchTimestamp] record failed" },
		malformed: { policy: "retry" },
		handle: async (detail) => {
			logger.info("[UpdateFetchTimestamp] processing", { url: detail.url });

			await updateFetchTimestamp(detail);

			logger.info("[UpdateFetchTimestamp] completed", { url: detail.url });
		},
	});
}
