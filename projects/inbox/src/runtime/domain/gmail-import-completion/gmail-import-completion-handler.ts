import { EmailOutputKeySchema, type EmailImportCompletionStore } from "@packages/domain/inbox";
import { EmailOutputSavedToAllEvent, EmailOutputsSelectedEvent } from "@packages/infra-components";
import type { Logger } from "@packages/logger";
import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { EvaluateGmailImportCompletion } from "./evaluate-gmail-import-completion";

export function initGmailImportCompletionHandler(deps: {
	acknowledgeOutput: EmailImportCompletionStore["acknowledgeOutput"];
	evaluate: EvaluateGmailImportCompletion;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { acknowledgeOutput, evaluate, logger } = deps;

	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];
		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detailType = envelope["detail-type"];
				if (detailType === EmailOutputSavedToAllEvent.detailType) {
					const detail = EmailOutputSavedToAllEvent.detailSchema.parse(envelope.detail);
					const userId = detail.userId;
					await acknowledgeOutput({
						userId,
						receivedAtMessageId: detail.receivedAtMessageId,
						output: EmailOutputKeySchema.parse(detail.outputKey),
					});
					const outcome = await evaluate({ userId, receivedAtMessageId: detail.receivedAtMessageId });
					logger.info("[gmail-import-completion] output saved to All", { outcome, outputKey: detail.outputKey });
					continue;
				}
				const detail = EmailOutputsSelectedEvent.detailSchema.parse(envelope.detail);
				const outcome = await evaluate({ userId: detail.userId, receivedAtMessageId: detail.receivedAtMessageId });
				logger.info("[gmail-import-completion] outputs selected", { outcome, outputCount: detail.outputCount });
			} catch (error) {
				logger.error("[gmail-import-completion] record failed", { messageId: record.messageId, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}
		return { batchItemFailures };
	};
}
