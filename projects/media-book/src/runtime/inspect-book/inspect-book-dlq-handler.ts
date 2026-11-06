import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { MediaRejectedEvent, MediaUploadStagedEvent } from "@packages/infra-components";
import { initSqsRecordHandler, type PublishEvent } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
import { PROCESSING_EXHAUSTED_NOTICE } from "../process-book/book-failure-notices";

export function initInspectBookDlqHandler(deps: { publishEvent: PublishEvent; logger: Logger }): Handler<SQSEvent, SQSBatchResponse> {
	return initSqsRecordHandler({
		definition: MediaUploadStagedEvent,
		logger: deps.logger,
		failure: { message: "[inspect-book-dlq] record failed" },
		malformed: { policy: "retry" },
		handle: async ({ uploadId, kind }, { receiveCount }) => {
			await deps.publishEvent(MediaRejectedEvent, { uploadId, kind, reason: "processing-exhausted", notice: PROCESSING_EXHAUSTED_NOTICE });
			deps.logger.error("[inspect-book-dlq] book inspection exhausted", { uploadId, receiveCount });
		},
	});
}
