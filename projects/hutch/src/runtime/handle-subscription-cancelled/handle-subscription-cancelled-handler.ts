import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { ConditionalCheckFailedException } from "@packages/storage-client";
import { initSqsRecordHandler } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
import { SubscriptionCancelledEvent } from "@packages/infra-components";
import type { MarkSubscriptionCancelledByUserId } from "@packages/provider-contracts/subscription-providers";
import type { EmitSubscriptionEvent } from "../observability/subscription-events";

export function initHandleSubscriptionCancelledHandler(deps: {
	markCancelledByUserId: MarkSubscriptionCancelledByUserId;
	emit: EmitSubscriptionEvent;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	return initSqsRecordHandler({
		definition: SubscriptionCancelledEvent,
		logger: deps.logger,
		failure: { message: "[SubscriptionCancelled] record failed" },
		malformed: { policy: "retry" },
		handle: async (detail) => {
			const { userId } = detail;
			try {
				await deps.markCancelledByUserId({ userId });
			} catch (error) {
				// The subscription row is gone — account deletion removed it before
				// this (possibly duplicate) cancellation event was processed. The
				// desired end state already holds, so treat the missing row as an
				// idempotent no-op instead of failing the record into the DLQ.
				if (!(error instanceof ConditionalCheckFailedException)) throw error;
				deps.logger.info("[SubscriptionCancelled] no subscription row (account deleted) — no-op", {
					userId,
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
