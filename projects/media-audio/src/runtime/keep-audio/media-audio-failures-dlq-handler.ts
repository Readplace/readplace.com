import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { MediaProcessingFailedEvent, MediaUploadCommittedEvent } from "@packages/infra-components";
import { initSqsRecordHandler, type PublishEvent } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
import { AUDIO_FAILURE_NOTICES } from "./audio-failure-notices";

export function initKeepAudioDlqHandler(deps: { publishEvent: PublishEvent; logger: Logger }): Handler<SQSEvent, SQSBatchResponse> {
	return initSqsRecordHandler({
		definition: MediaUploadCommittedEvent,
		logger: deps.logger,
		failure: { message: "[keep-audio-dlq] record failed" },
		malformed: { policy: "retry" },
		handle: async ({ uploadId, kind, url, saveAttemptId, attempt }, { receiveCount }) => {
			await deps.publishEvent(MediaProcessingFailedEvent, {
				uploadId,
				kind,
				url,
				saveAttemptId,
				attempt,
				reason: "processing-exhausted",
				notice: AUDIO_FAILURE_NOTICES["processing-exhausted"],
			});
			deps.logger.error("[keep-audio-dlq] audio processing exhausted", { uploadId, receiveCount });
		},
	});
}
