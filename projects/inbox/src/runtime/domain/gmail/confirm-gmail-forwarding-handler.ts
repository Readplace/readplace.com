import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import {
	ConfirmGmailForwardingCommand,
	GmailForwardingConfirmedEvent,
	GmailForwardingConfirmFailedEvent,
} from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { HutchLogger } from "@packages/hutch-logger";
import type { ConfirmForwardingAddress } from "./confirm-forwarding-address";

export function initConfirmGmailForwardingHandler(deps: {
	confirmForwardingAddress: ConfirmForwardingAddress;
	publishEvent: PublishEvent;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { confirmForwardingAddress, publishEvent, logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const parsed = ConfirmGmailForwardingCommand.detailSchema.safeParse(envelope.detail);
				if (!parsed.success) {
					logger.error("[confirm-gmail-forwarding] malformed command", {
						messageId: record.messageId,
					});
					batchItemFailures.push({ itemIdentifier: record.messageId });
					continue;
				}
				const { userId, forwardingAddress, verifyUrl } = parsed.data;

				const result = await confirmForwardingAddress({ verifyUrl });
				if (result.ok) {
					await publishEvent(GmailForwardingConfirmedEvent, { userId, forwardingAddress });
					logger.info("[confirm-gmail-forwarding] confirmed", { forwardingAddress });
					continue;
				}
				if (result.reason === "unavailable") {
					logger.warn("[confirm-gmail-forwarding] google unavailable, retrying", {
						forwardingAddress,
						status: result.status,
					});
					batchItemFailures.push({ itemIdentifier: record.messageId });
					continue;
				}
				await publishEvent(GmailForwardingConfirmFailedEvent, {
					userId,
					forwardingAddress,
					reason: result.reason,
				});
				if (result.reason === "token-rejected") {
					logger.warn("[confirm-gmail-forwarding] token spent or expired", {
						forwardingAddress,
					});
					continue;
				}
				logger.error("[confirm-gmail-forwarding] confirmation did not complete", {
					forwardingAddress,
					reason: result.reason,
				});
			} catch (error) {
				logger.error("[confirm-gmail-forwarding] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
