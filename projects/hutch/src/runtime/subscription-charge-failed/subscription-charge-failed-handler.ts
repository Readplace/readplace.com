import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import { SubscriptionChargeFailedEvent } from "@packages/hutch-infra-components";
import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishCancelSubscriptionCommand } from "@packages/test-fixtures/providers/events";
import type { EmitSubscriptionEvent } from "../observability/subscription-events";

export function initSubscriptionChargeFailedHandler(deps: {
	publishCancelSubscriptionCommand: PublishCancelSubscriptionCommand;
	emit: EmitSubscriptionEvent;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = z.object({ detail: z.unknown() }).parse(JSON.parse(record.body));
				const detail = SubscriptionChargeFailedEvent.detailSchema.parse(envelope.detail);
				const userId = UserIdSchema.parse(detail.userId);
				deps.logger.info("[charge-failed] dispatching cancel", {
					userId,
					reason: detail.reason,
				});
				await deps.publishCancelSubscriptionCommand({ userId });
				deps.emit.chargeFailed({ userId, reason: detail.reason });
			} catch (error) {
				deps.logger.error("[charge-failed] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
