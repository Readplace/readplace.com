import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { MediaProcessingFailedEvent, MediaUploadCommittedEvent } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { HutchLogger } from "@packages/hutch-logger";
import { z } from "zod";

const PROCESSING_EXHAUSTED_NOTICE = "We couldn't prepare this book. Please upload it again.";

export function initProcessBookDlqHandler(deps: { publishEvent: PublishEvent; logger: HutchLogger }): Handler<SQSEvent, SQSBatchResponse> {
	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];
		for (const record of event.Records) {
			try {
				const envelope = z.object({ detail: MediaUploadCommittedEvent.detailSchema }).parse(JSON.parse(record.body));
				const { uploadId, kind, url, saveAttemptId, attempt } = envelope.detail;
				await deps.publishEvent(MediaProcessingFailedEvent, {
					uploadId,
					kind,
					url,
					saveAttemptId,
					attempt,
					reason: "processing-exhausted",
					notice: PROCESSING_EXHAUSTED_NOTICE,
				});
				deps.logger.error("[process-book-dlq] book processing exhausted", { uploadId, receiveCount: record.attributes.ApproximateReceiveCount });
			} catch (error) {
				deps.logger.error("[process-book-dlq] record failed", { messageId: record.messageId, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}
		return { batchItemFailures };
	};
}
