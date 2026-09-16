import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { GmailForwardingConfirmFailedEvent } from "@packages/hutch-infra-components";
import type { GmailConnectionStore } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";

export function initGmailForwardingConfirmFailedHandler(deps: {
	connections: GmailConnectionStore;
	now: () => Date;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { connections, now, logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const parsed = GmailForwardingConfirmFailedEvent.detailSchema.safeParse(envelope.detail);
				if (!parsed.success) {
					logger.error("[gmail-forwarding-confirm-failed] malformed event", {
						messageId: record.messageId,
					});
					batchItemFailures.push({ itemIdentifier: record.messageId });
					continue;
				}
				const userId = UserIdSchema.parse(parsed.data.userId);
				const forwardingAddress = InboxAddressSchema.parse(parsed.data.forwardingAddress);

				const connection = await connections.findConnectionByUserId(userId);
				if (
					connection === undefined ||
					forwardingAddress !== connection.gatewayAddress ||
					connection.forwardingConfirmedAt !== undefined
				) {
					logger.info("[gmail-forwarding-confirm-failed] no unconfirmed gateway to mark", {
						userId,
						reason: parsed.data.reason,
					});
					continue;
				}
				await connections.recordConfirmError({
					userId,
					error: { reason: parsed.data.reason, at: now().toISOString() },
				});
				logger.info("[gmail-forwarding-confirm-failed] confirmation failure recorded", {
					userId,
					reason: parsed.data.reason,
				});
			} catch (error) {
				logger.error("[gmail-forwarding-confirm-failed] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
