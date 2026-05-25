import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import { SubscriptionChargeSucceededEvent } from "@packages/hutch-infra-components";
import type { HutchLogger } from "@packages/hutch-logger";
import type { UpsertActiveSubscription } from "@packages/test-fixtures/providers/subscription-providers";
import type { EmitSubscriptionEvent } from "../observability/subscription-events";

export function initSubscriptionChargeSucceededHandler(deps: {
	upsertActive: UpsertActiveSubscription;
	emit: EmitSubscriptionEvent;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = z.object({ detail: z.unknown() }).parse(JSON.parse(record.body));
				const detail = SubscriptionChargeSucceededEvent.detailSchema.parse(envelope.detail);
				const userId = UserIdSchema.parse(detail.userId);
				await deps.upsertActive({
					userId,
					subscriptionId: detail.subscriptionId,
					customerId: detail.customerId,
				});
				deps.emit.chargeSucceeded({
					userId,
					subscriptionId: detail.subscriptionId,
				});
				deps.logger.info("[charge-succeeded] upserted active", {
					userId,
					subscriptionId: detail.subscriptionId,
				});
			} catch (error) {
				deps.logger.error("[charge-succeeded] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
