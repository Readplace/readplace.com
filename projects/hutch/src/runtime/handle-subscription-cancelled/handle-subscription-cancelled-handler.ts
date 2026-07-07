import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { z } from "zod";
import { ConditionalCheckFailedException } from "@packages/hutch-storage-client";
import { UserIdSchema } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import { SubscriptionCancelledEvent } from "@packages/hutch-infra-components";
import type { MarkSubscriptionCancelledByUserId } from "@packages/provider-contracts/subscription-providers";
import type { EmitSubscriptionEvent } from "../observability/subscription-events";

export function initHandleSubscriptionCancelledHandler(deps: {
	markCancelledByUserId: MarkSubscriptionCancelledByUserId;
	emit: EmitSubscriptionEvent;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = z.object({ detail: z.unknown() }).parse(JSON.parse(record.body));
				const detail = SubscriptionCancelledEvent.detailSchema.parse(envelope.detail);
				const userId = UserIdSchema.parse(detail.userId);
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
					continue;
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
