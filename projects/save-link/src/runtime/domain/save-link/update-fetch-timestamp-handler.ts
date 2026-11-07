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

export type AdvanceContentFetchedAt = (params: {
	url: string;
	contentFetchedAt: string;
}) => Promise<"advanced" | "superseded">;

export function initUpdateFetchTimestampHandler(deps: {
	advanceContentFetchedAt: AdvanceContentFetchedAt;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { advanceContentFetchedAt, logger } = deps;

	return initSqsRecordHandler({
		definition: UpdateFetchTimestampCommand,
		logger,
		failure: { message: "[UpdateFetchTimestamp] record failed" },
		malformed: { policy: "retry" },
		handle: async (detail) => {
			logger.info("[UpdateFetchTimestamp] processing", { url: detail.url });

			const outcome = await advanceContentFetchedAt({
				url: detail.url,
				contentFetchedAt: detail.contentFetchedAt,
			});

			logger.info("[UpdateFetchTimestamp] completed", { url: detail.url, outcome });
		},
	});
}
