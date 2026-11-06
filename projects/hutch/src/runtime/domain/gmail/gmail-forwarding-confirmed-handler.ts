import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import {
	GmailForwardingConfirmedEvent,
	RewriteGmailFilterCommand,
} from "@packages/infra-components";
import { initSqsRecordHandler, type PublishEvent } from "@packages/infra-components/runtime";
import type { GmailConnectionStore } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import type { Logger } from "@packages/logger";

export function initGmailForwardingConfirmedHandler(deps: {
	connections: GmailConnectionStore;
	publishEvent: PublishEvent;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { connections, publishEvent, logger } = deps;

	return initSqsRecordHandler({
		definition: GmailForwardingConfirmedEvent,
		logger,
		failure: { message: "[gmail-forwarding-confirmed] record failed" },
		malformed: {
			policy: "retry",
			report: ({ record }) =>
				logger.error("[gmail-forwarding-confirmed] malformed event", {
					messageId: record.messageId,
				}),
		},
		handle: async (detail) => {
			const { userId } = detail;
			const forwardingAddress = InboxAddressSchema.parse(detail.forwardingAddress);

			const connection = await connections.findConnectionByUserId(userId);
			if (connection !== undefined && forwardingAddress === connection.gatewayAddress) {
				await connections.markForwardingConfirmed({ userId });
			}
			await publishEvent(RewriteGmailFilterCommand, {
				userId,
				reason: "forwarding-confirmed",
			});
			logger.info("[gmail-forwarding-confirmed] address confirmed", {
				userId,
			});
		},
	});
}
