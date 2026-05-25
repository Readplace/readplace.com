import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import { PaymentMethodAddedEvent } from "@packages/hutch-infra-components";
import type { HutchLogger } from "@packages/hutch-logger";
import type {
	FindSubscriptionByUserIdConsistent,
} from "@packages/test-fixtures/providers/subscription-providers";
import type {
	PublishSubscriptionStartRequestCommand,
} from "@packages/test-fixtures/providers/events";

export function initPaymentMethodAddedHandler(deps: {
	findByUserIdConsistent: FindSubscriptionByUserIdConsistent;
	publishSubscriptionStartRequestCommand: PublishSubscriptionStartRequestCommand;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	async function processRecord(body: string): Promise<void> {
		const envelope = z.object({ detail: z.unknown() }).parse(JSON.parse(body));
		const detail = PaymentMethodAddedEvent.detailSchema.parse(envelope.detail);
		const userId = UserIdSchema.parse(detail.userId);

		const row = await deps.findByUserIdConsistent(userId);
		if (!row) {
			deps.logger.warn("[payment-method-added] no row for user — noop", { userId });
			return;
		}

		/** Active rows never need a charge dispatched on add (they're already
		 * charged). Trialing and cancelled rows both flow through the start-
		 * request handler, which decides whether to wait (trial still active)
		 * or charge immediately (trial expired or cancelled). */
		if (row.status !== "trialing" && row.status !== "cancelled") {
			deps.logger.info("[payment-method-added] non-chargeable status — noop", {
				userId,
				status: row.status,
			});
			return;
		}

		await deps.publishSubscriptionStartRequestCommand({ userId });
	}

	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				await processRecord(record.body);
			} catch (error) {
				deps.logger.error("[payment-method-added] record failed", {
					messageId: record.messageId,
					error: error instanceof Error ? error.message : String(error),
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
