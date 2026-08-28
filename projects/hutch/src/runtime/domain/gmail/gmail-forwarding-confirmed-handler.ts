import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import {
	GmailForwardingConfirmedEvent,
	RewriteGmailFilterCommand,
} from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { GmailConnectionStore } from "@packages/domain/gmail";
import { UserIdSchema } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";

export function initGmailForwardingConfirmedHandler(deps: {
	connections: GmailConnectionStore;
	publishEvent: PublishEvent;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { connections, publishEvent, logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const parsed = GmailForwardingConfirmedEvent.detailSchema.safeParse(envelope.detail);
				if (!parsed.success) {
					logger.error("[gmail-forwarding-confirmed] malformed event", {
						messageId: record.messageId,
					});
					batchItemFailures.push({ itemIdentifier: record.messageId });
					continue;
				}
				const userId = UserIdSchema.parse(parsed.data.userId);

				await connections.markForwardingConfirmed({ userId });
				await publishEvent(RewriteGmailFilterCommand, {
					userId,
					reason: "forwarding-confirmed",
				});
				logger.info("[gmail-forwarding-confirmed] connection confirmed", {
					forwardingAddress: parsed.data.forwardingAddress,
				});
			} catch (error) {
				logger.error("[gmail-forwarding-confirmed] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
