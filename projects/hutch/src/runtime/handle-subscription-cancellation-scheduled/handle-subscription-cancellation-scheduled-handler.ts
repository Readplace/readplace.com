import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { initSqsRecordHandler } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
import { SubscriptionCancellationScheduledEvent } from "@packages/infra-components";
import type { MarkSubscriptionPendingCancellation } from "@packages/provider-contracts/subscription-providers";

export function initHandleSubscriptionCancellationScheduledHandler(deps: {
	markPendingCancellation: MarkSubscriptionPendingCancellation;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	return initSqsRecordHandler({
		definition: SubscriptionCancellationScheduledEvent,
		logger: deps.logger,
		failure: { message: "[SubscriptionCancellationScheduled] record failed" },
		malformed: { policy: "retry" },
		handle: async (detail) => {
			await deps.markPendingCancellation({
				userId: detail.userId,
				cancellationEffectiveAt: detail.cancellationEffectiveAt,
			});
			deps.logger.info("[SubscriptionCancellationScheduled] marked pending_cancellation", {
				userId: detail.userId,
				subscriptionId: detail.subscriptionId,
				cancellationEffectiveAt: detail.cancellationEffectiveAt,
			});
		},
	});
}
