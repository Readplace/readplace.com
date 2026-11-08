import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { EventEnvelope } from "@packages/domain/event-envelope";
import { ConditionalCheckFailedException } from "@packages/storage-client";
import { initSqsRecordHandler } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
import { SubscriptionCancelledEvent } from "@packages/infra-components";
import type { MarkSubscriptionCancelledByEvent } from "@packages/provider-contracts/subscription-providers";
import type { EmitSubscriptionEvent } from "../observability/subscription-events";

export function initHandleSubscriptionCancelledHandler(deps: {
	markCancelledByEvent: MarkSubscriptionCancelledByEvent;
	emit: EmitSubscriptionEvent;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	return initSqsRecordHandler({
		definition: SubscriptionCancelledEvent,
		logger: deps.logger,
		failure: { message: "[SubscriptionCancelled] record failed" },
		malformed: { policy: "retry" },
		handle: async (detail, record) => {
			const { userId } = detail;
			const { time: eventTime } = EventEnvelope.parse(JSON.parse(record.body));
			try {
				await deps.markCancelledByEvent({ userId, eventTime });
			} catch (error) {
				if (!(error instanceof ConditionalCheckFailedException)) throw error;
				deps.logger.info("[SubscriptionCancelled] row missing or message predates row status — no-op", {
					userId,
					eventTime,
				});
				return;
			}
			deps.emit.cancelled({
				userId,
				reason: detail.reason,
				subscriptionId: detail.subscriptionId,
			});
			deps.logger.info("[SubscriptionCancelled] marked cancelled", {
				userId,
				subscriptionId: detail.subscriptionId,
				reason: detail.reason,
			});
		},
	});
}
