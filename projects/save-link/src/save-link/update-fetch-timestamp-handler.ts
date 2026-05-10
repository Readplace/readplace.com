import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import { UpdateFetchTimestampCommand } from "./index";

export type UpdateFetchTimestamp = (params: {
	url: string;
	contentFetchedAt: string;
	etag?: string;
	lastModified?: string;
}) => Promise<void>;

export function initUpdateFetchTimestampHandler(deps: {
	updateFetchTimestamp: UpdateFetchTimestamp;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { updateFetchTimestamp, logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = UpdateFetchTimestampCommand.detailSchema.parse(envelope.detail);

				logger.info("[UpdateFetchTimestamp] processing", { url: detail.url });

				await updateFetchTimestamp(detail);

				logger.info("[UpdateFetchTimestamp] completed", { url: detail.url });
			} catch (error) {
				logger.error("[UpdateFetchTimestamp] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
