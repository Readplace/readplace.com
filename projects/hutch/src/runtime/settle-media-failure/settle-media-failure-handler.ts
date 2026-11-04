import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { FailMediaUpload } from "@packages/domain";
import { MediaProcessingFailedEvent } from "@packages/infra-components";
import { initSqsRecordHandler } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
import type { RecordPrivateItemFailure } from "@packages/provider-contracts/article-store";

export function initSettleMediaFailureHandler(deps: {
	recordPrivateItemFailure: RecordPrivateItemFailure;
	failMediaUpload: FailMediaUpload;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	return initSqsRecordHandler({
		definition: MediaProcessingFailedEvent,
		logger: deps.logger,
		failure: { message: "[settle-media-failure] record failed" },
		malformed: { policy: "retry" },
		handle: async (detail, { messageId }) => {
			const item = await deps.recordPrivateItemFailure({ url: detail.url, notice: detail.notice });
			const session = await deps.failMediaUpload({ uploadId: detail.uploadId });
			deps.logger.info("[settle-media-failure] failure settled", {
				messageId,
				uploadId: detail.uploadId,
				reason: detail.reason,
				item,
				session,
			});
		},
	});
}
