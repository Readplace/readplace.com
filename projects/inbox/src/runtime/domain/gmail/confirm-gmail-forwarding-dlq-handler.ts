import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { ConfirmGmailForwardingCommand } from "@packages/hutch-infra-components";
import type { HutchLogger } from "@packages/hutch-logger";

export function initConfirmGmailForwardingDlqHandler(deps: {
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		for (const record of event.Records) {
			const receiveCount = Number(record.attributes.ApproximateReceiveCount);
			try {
				const envelope = JSON.parse(record.body);
				const parsed = ConfirmGmailForwardingCommand.detailSchema.safeParse(envelope.detail);
				if (!parsed.success) {
					logger.error("[confirm-gmail-forwarding-dlq] unidentifiable command", {
						messageId: record.messageId,
						receiveCount,
					});
					continue;
				}
				logger.error("[confirm-gmail-forwarding-dlq] confirmation gave up", {
					forwardingAddress: parsed.data.forwardingAddress,
					receiveCount,
				});
			} catch (error) {
				logger.error("[confirm-gmail-forwarding-dlq] record failed", {
					messageId: record.messageId,
					error,
				});
			}
		}

		return { batchItemFailures: [] };
	};
}
