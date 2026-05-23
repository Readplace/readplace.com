import assert from "node:assert";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2, Handler } from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import { SubscriptionCancelledEvent } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { FindSubscriptionBySubscriptionId } from "@packages/test-fixtures/providers/subscription-providers";
import { verifyStripeSignature } from "./verify-stripe-signature";

export function initStripeWebhookReceiverHandler(deps: {
	webhookSecret: string;
	publishEvent: PublishEvent;
	findSubscriptionBySubscriptionId: FindSubscriptionBySubscriptionId;
	logger: HutchLogger;
	now: () => Date;
}): Handler<APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2> {
	return async (event) => {
		const signatureHeader = event.headers["stripe-signature"];
		if (!signatureHeader) {
			return { statusCode: 400, body: "Missing signature" };
		}

		assert(event.body, "API Gateway POST route always provides a body");
		const rawBody = event.isBase64Encoded
			? Buffer.from(event.body, "base64")
			: Buffer.from(event.body, "utf-8");

		const verifyResult = verifyStripeSignature({
			rawBody,
			signatureHeader,
			secret: deps.webhookSecret,
			nowSeconds: Math.floor(deps.now().getTime() / 1000),
		});

		if (!verifyResult.ok) {
			deps.logger.warn("[stripe-webhook] invalid signature", { reason: verifyResult.reason });
			return { statusCode: 400, body: "Bad signature" };
		}

		const stripeEvent = verifyResult.event;

		if (stripeEvent.type === "customer.subscription.deleted") {
			const subscriptionId = stripeEvent.data.object.id;
			const row = await deps.findSubscriptionBySubscriptionId(subscriptionId);
			if (!row) {
				deps.logger.warn("[stripe-webhook] no subscription row found — skipping event emission", {
					subscriptionId,
				});
				return { statusCode: 200, body: "" };
			}
			await deps.publishEvent({
				source: SubscriptionCancelledEvent.source,
				detailType: SubscriptionCancelledEvent.detailType,
				detail: JSON.stringify(
					SubscriptionCancelledEvent.detailSchema.parse({
						userId: row.userId,
						subscriptionId,
						reason: "stripe_webhook",
					}),
				),
			});
			deps.logger.info("[stripe-webhook] emitted SubscriptionCancelled", {
				userId: row.userId,
				subscriptionId,
			});
		}

		/** Unknown event types are silently accepted with 200 — adding new
		 * domain-event mappings means extending the if-chain above. Known
		 * events reach here only after successful EventBridge publish. */
		return { statusCode: 200, body: "" };
	};
}
