import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { EventEnvelope } from "@packages/domain/event-envelope";
import { ConditionalCheckFailedException } from "@packages/storage-client";
import { initSqsRecordHandler } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
import { SubscriptionCancellationScheduledEvent } from "@packages/infra-components";
import type { MarkSubscriptionPendingCancellationByEvent } from "@packages/provider-contracts/subscription-providers";

export function initHandleSubscriptionCancellationScheduledHandler(deps: {
	markPendingCancellationByEvent: MarkSubscriptionPendingCancellationByEvent;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	return initSqsRecordHandler({
		definition: SubscriptionCancellationScheduledEvent,
		logger: deps.logger,
		failure: { message: "[SubscriptionCancellationScheduled] record failed" },
		malformed: { policy: "retry" },
		handle: async (detail, record) => {
			const { time: eventTime } = EventEnvelope.parse(JSON.parse(record.body));
			try {
				await deps.markPendingCancellationByEvent({
					userId: detail.userId,
					cancellationEffectiveAt: detail.cancellationEffectiveAt,
					eventTime,
				});
			} catch (error) {
				if (!(error instanceof ConditionalCheckFailedException)) throw error;
				deps.logger.info("[SubscriptionCancellationScheduled] row missing or message predates row status — no-op", {
					userId: detail.userId,
					eventTime,
				});
				return;
			}
			deps.logger.info("[SubscriptionCancellationScheduled] marked pending_cancellation", {
				userId: detail.userId,
				subscriptionId: detail.subscriptionId,
				cancellationEffectiveAt: detail.cancellationEffectiveAt,
			});
		},
	});
}
