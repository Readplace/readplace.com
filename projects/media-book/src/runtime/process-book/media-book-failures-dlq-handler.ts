import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { MediaProcessingFailedEvent, MediaUploadCommittedEvent } from "@packages/infra-components";
import { initSqsRecordHandler, type PublishEvent } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";

const PROCESSING_EXHAUSTED_NOTICE = "We couldn't prepare this book. Please upload it again.";

export function initProcessBookDlqHandler(deps: { publishEvent: PublishEvent; logger: Logger }): Handler<SQSEvent, SQSBatchResponse> {
	return initSqsRecordHandler({
		definition: MediaUploadCommittedEvent,
		logger: deps.logger,
		failure: { message: "[process-book-dlq] record failed" },
		malformed: { policy: "retry" },
		handle: async ({ uploadId, kind, url, saveAttemptId, attempt }, { receiveCount }) => {
			await deps.publishEvent(MediaProcessingFailedEvent, {
				uploadId,
				kind,
				url,
				saveAttemptId,
				attempt,
				reason: "processing-exhausted",
				notice: PROCESSING_EXHAUSTED_NOTICE,
			});
			deps.logger.error("[process-book-dlq] book processing exhausted", { uploadId, receiveCount });
		},
	});
}
