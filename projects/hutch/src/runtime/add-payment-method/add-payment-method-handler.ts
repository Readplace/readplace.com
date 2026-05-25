import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import { AddPaymentMethodCommand } from "@packages/hutch-infra-components";
import type { HutchLogger } from "@packages/hutch-logger";
import type {
	UpsertPaymentMethod,
} from "@packages/test-fixtures/providers/subscription-providers";
import type {
	SetDefaultPaymentMethod,
} from "@packages/test-fixtures/providers/stripe-subscriptions";
import type {
	PublishPaymentMethodAdded,
} from "@packages/test-fixtures/providers/events";

export function initAddPaymentMethodHandler(deps: {
	upsertPaymentMethod: UpsertPaymentMethod;
	setDefaultPaymentMethod: SetDefaultPaymentMethod;
	publishPaymentMethodAdded: PublishPaymentMethodAdded;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	async function processRecord(body: string): Promise<void> {
		const envelope = z.object({ detail: z.unknown() }).parse(JSON.parse(body));
		const detail = AddPaymentMethodCommand.detailSchema.parse(envelope.detail);
		const userId = UserIdSchema.parse(detail.userId);

		/** PATCH the Stripe Customer first so the DB write is always followed
		 * by a Stripe state that agrees with it. If we wrote the row first and
		 * Stripe failed, a later subscriptions.create wouldn't know which card
		 * to charge. Idempotency-Key on the Stripe call makes SQS retries safe. */
		await deps.setDefaultPaymentMethod({
			customerId: detail.customerId,
			paymentMethodId: detail.paymentMethodId,
		});

		await deps.upsertPaymentMethod({
			userId,
			paymentMethodId: detail.paymentMethodId,
			brand: detail.brand,
			last4: detail.last4,
		});

		await deps.publishPaymentMethodAdded({ userId });
		deps.logger.info("[add-payment-method] attached and persisted", {
			userId,
			paymentMethodId: detail.paymentMethodId,
		});
	}

	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				await processRecord(record.body);
			} catch (error) {
				deps.logger.error("[add-payment-method] record failed", {
					messageId: record.messageId,
					error: error instanceof Error ? error.message : String(error),
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
