import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { DisconnectGmailCommand, GmailDisconnectedEvent } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { UserIdSchema } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import type { DisconnectGmail } from "./disconnect-gmail";

export function initDisconnectGmailHandler(deps: {
	disconnectGmail: DisconnectGmail;
	publishEvent: PublishEvent;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { disconnectGmail, publishEvent, logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const parsed = DisconnectGmailCommand.detailSchema.safeParse(envelope.detail);
				if (!parsed.success) {
					logger.error("[disconnect-gmail] malformed command", { messageId: record.messageId });
					batchItemFailures.push({ itemIdentifier: record.messageId });
					continue;
				}
				const userId = UserIdSchema.parse(parsed.data.userId);

				const result = await disconnectGmail({ userId });
				if (result.ok) {
					await publishEvent(GmailDisconnectedEvent, {
						userId,
						filterRemoved: result.filterRemoved,
						grantRevoked: result.grantRevoked,
					});
					logger.info("[disconnect-gmail] disconnected", {
						userId,
						filterRemoved: result.filterRemoved,
						grantRevoked: result.grantRevoked,
					});
					continue;
				}
				if (result.reason === "unavailable") {
					logger.warn("[disconnect-gmail] google unavailable, retrying", { userId });
					batchItemFailures.push({ itemIdentifier: record.messageId });
					continue;
				}
				logger.warn("[disconnect-gmail] nothing to disconnect", { userId });
			} catch (error) {
				logger.error("[disconnect-gmail] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
