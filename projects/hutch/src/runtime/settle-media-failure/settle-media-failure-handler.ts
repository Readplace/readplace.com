import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { FailMediaUpload } from "@packages/domain";
import { MediaProcessingFailedEvent } from "@packages/hutch-infra-components";
import type { HutchLogger } from "@packages/hutch-logger";
import type { RecordPrivateItemFailure } from "@packages/provider-contracts/article-store";
import { z } from "zod";

export function initSettleMediaFailureHandler(deps: {
	recordPrivateItemFailure: RecordPrivateItemFailure;
	failMediaUpload: FailMediaUpload;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = z.object({ detail: z.unknown() }).parse(JSON.parse(record.body));
				const detail = MediaProcessingFailedEvent.detailSchema.parse(envelope.detail);
				const item = await deps.recordPrivateItemFailure({ url: detail.url, notice: detail.notice });
				const session = await deps.failMediaUpload({ uploadId: detail.uploadId });
				deps.logger.info("[settle-media-failure] failure settled", {
					messageId: record.messageId,
					uploadId: detail.uploadId,
					reason: detail.reason,
					item,
					session,
				});
			} catch (error) {
				deps.logger.error("[settle-media-failure] record failed", { messageId: record.messageId, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
