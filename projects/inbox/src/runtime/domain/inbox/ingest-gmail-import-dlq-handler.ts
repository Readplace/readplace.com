import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import {
	GmailHistoryImportMessageFetchedEvent,
	GmailHistoryImportMessageIngestedEvent,
} from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { HutchLogger } from "@packages/hutch-logger";

export function initIngestGmailImportDlqHandler(deps: {
	publishEvent: PublishEvent;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { publishEvent, logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];
		for (const record of event.Records) {
			const receiveCount = Number(record.attributes.ApproximateReceiveCount);
			const parsed = GmailHistoryImportMessageFetchedEvent.detailSchema.safeParse(
				parseJsonDetail(record.body),
			);
			if (!parsed.success) {
				logger.error("[ingest-gmail-import-dlq] unidentifiable fetched message", {
					messageId: record.messageId,
					receiveCount,
				});
				continue;
			}
			const { userId, jobId, generation, gmailMessageId } = parsed.data;
			try {
				await publishEvent(GmailHistoryImportMessageIngestedEvent, {
					userId,
					jobId,
					generation,
					gmailMessageId,
					outcome: "failed",
				});
				logger.error("[ingest-gmail-import-dlq] import message gave up", { userId, jobId, receiveCount });
			} catch (error) {
				logger.error("[ingest-gmail-import-dlq] record failed", { messageId: record.messageId, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}
		return { batchItemFailures };
	};
}

function parseJsonDetail(body: string): unknown {
	try {
		return JSON.parse(body).detail;
	} catch {
		return undefined;
	}
}
