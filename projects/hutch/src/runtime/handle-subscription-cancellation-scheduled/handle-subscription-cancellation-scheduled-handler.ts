import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import { SubscriptionCancellationScheduledEvent } from "@packages/hutch-infra-components";
import type { MarkSubscriptionPendingCancellation } from "@packages/test-fixtures/providers/subscription-providers";

export function initHandleSubscriptionCancellationScheduledHandler(deps: {
	markPendingCancellation: MarkSubscriptionPendingCancellation;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = z.object({ detail: z.unknown() }).parse(JSON.parse(record.body));
				const detail = SubscriptionCancellationScheduledEvent.detailSchema.parse(envelope.detail);
				const userId = UserIdSchema.parse(detail.userId);
				await deps.markPendingCancellation({
					userId,
					cancellationEffectiveAt: detail.cancellationEffectiveAt,
				});
				deps.logger.info("[SubscriptionCancellationScheduled] marked pending_cancellation", {
					userId,
					subscriptionId: detail.subscriptionId,
					cancellationEffectiveAt: detail.cancellationEffectiveAt,
				});
			} catch (error) {
				deps.logger.error("[SubscriptionCancellationScheduled] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
