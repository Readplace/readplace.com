import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { z } from "zod";
import type { HutchLogger } from "@packages/hutch-logger";
import { SubscriptionCancelledEvent } from "@packages/hutch-infra-components";
import type { MarkSubscriptionCancelled } from "@packages/test-fixtures/providers/subscription-providers";

export function initHandleSubscriptionCancelledHandler(deps: {
	markCancelled: MarkSubscriptionCancelled;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = z.object({ detail: z.unknown() }).parse(JSON.parse(record.body));
				const detail = SubscriptionCancelledEvent.detailSchema.parse(envelope.detail);
				await deps.markCancelled({ subscriptionId: detail.subscriptionId });
				deps.logger.info("[SubscriptionCancelled] marked cancelled", {
					subscriptionId: detail.subscriptionId,
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
