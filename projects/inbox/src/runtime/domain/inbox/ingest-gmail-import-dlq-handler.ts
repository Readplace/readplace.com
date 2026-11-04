import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import {
	GmailHistoryImportMessageFetchedEvent,
	GmailHistoryImportMessageIngestedEvent,
} from "@packages/infra-components";
import { initSqsRecordHandler, type PublishEvent } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";

export function initIngestGmailImportDlqHandler(deps: {
	publishEvent: PublishEvent;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { publishEvent, logger } = deps;

	return initSqsRecordHandler({
		definition: GmailHistoryImportMessageFetchedEvent,
		logger,
		failure: { message: "[ingest-gmail-import-dlq] record failed" },
		malformed: {
			policy: "acknowledge",
			report: ({ record }) =>
				logger.error("[ingest-gmail-import-dlq] unidentifiable fetched message", {
					messageId: record.messageId,
					receiveCount: record.receiveCount,
				}),
		},
		handle: async ({ userId, jobId, generation, gmailMessageId }, { receiveCount }) => {
			await publishEvent(GmailHistoryImportMessageIngestedEvent, {
				userId,
				jobId,
				generation,
				gmailMessageId,
				outcome: "failed",
			});
			logger.error("[ingest-gmail-import-dlq] import message gave up", { userId, jobId, receiveCount });
		},
	});
}
