import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { GmailForwardingConfirmFailedEvent } from "@packages/infra-components";
import { initSqsRecordHandler } from "@packages/infra-components/runtime";
import type { GmailConnectionStore } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import type { Logger } from "@packages/logger";

export function initGmailForwardingConfirmFailedHandler(deps: {
	connections: GmailConnectionStore;
	now: () => Date;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { connections, now, logger } = deps;

	return initSqsRecordHandler({
		definition: GmailForwardingConfirmFailedEvent,
		logger,
		failure: { message: "[gmail-forwarding-confirm-failed] record failed" },
		malformed: {
			policy: "retry",
			report: ({ record }) =>
				logger.error("[gmail-forwarding-confirm-failed] malformed event", {
					messageId: record.messageId,
				}),
		},
		handle: async (detail) => {
			const { userId } = detail;
			const forwardingAddress = InboxAddressSchema.parse(detail.forwardingAddress);

			const connection = await connections.findConnectionByUserId(userId);
			if (
				connection === undefined ||
				forwardingAddress !== connection.gatewayAddress ||
				connection.forwardingConfirmedAt !== undefined
			) {
				logger.info("[gmail-forwarding-confirm-failed] no unconfirmed gateway to mark", {
					userId,
					reason: detail.reason,
				});
				return;
			}
			await connections.recordConfirmError({
				userId,
				error: { reason: detail.reason, at: now().toISOString() },
			});
			logger.info("[gmail-forwarding-confirm-failed] confirmation failure recorded", {
				userId,
				reason: detail.reason,
			});
		},
	});
}
