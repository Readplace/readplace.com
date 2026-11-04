import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { ConfirmGmailForwardingCommand } from "@packages/infra-components";
import { initSqsRecordHandler } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";

export function initConfirmGmailForwardingDlqHandler(deps: {
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { logger } = deps;

	return initSqsRecordHandler({
		definition: ConfirmGmailForwardingCommand,
		logger,
		failure: { message: "[confirm-gmail-forwarding-dlq] record failed" },
		malformed: {
			policy: "acknowledge",
			report: ({ record }) =>
				logger.error("[confirm-gmail-forwarding-dlq] unidentifiable command", {
					messageId: record.messageId,
					receiveCount: record.receiveCount,
				}),
		},
		handle: async (detail, record) => {
			logger.error("[confirm-gmail-forwarding-dlq] confirmation gave up", {
				userId: detail.userId,
				receiveCount: record.receiveCount,
			});
		},
	});
}
