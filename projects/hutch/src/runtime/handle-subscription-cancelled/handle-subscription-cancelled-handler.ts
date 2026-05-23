import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import { SubscriptionCancelledEvent } from "@packages/hutch-infra-components";
import type { MarkSubscriptionCancelledByUserId } from "@packages/test-fixtures/providers/subscription-providers";

export function initHandleSubscriptionCancelledHandler(deps: {
	markCancelledByUserId: MarkSubscriptionCancelledByUserId;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = z.object({ detail: z.unknown() }).parse(JSON.parse(record.body));
				const detail = SubscriptionCancelledEvent.detailSchema.parse(envelope.detail);
				const userId = UserIdSchema.parse(detail.userId);
				await deps.markCancelledByUserId({ userId });
				deps.logger.info("[SubscriptionCancelled] marked cancelled", {
					userId,
					subscriptionId: detail.subscriptionId,
					reason: detail.reason,
				});
			} catch (error) {
				deps.logger.error("[SubscriptionCancelled] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
