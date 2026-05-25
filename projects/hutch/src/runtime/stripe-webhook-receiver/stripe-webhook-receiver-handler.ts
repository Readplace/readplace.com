import assert from "node:assert";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2, Handler } from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import type { StripeEventType } from "@packages/hutch-infra-components";
import { UnconfiguredStripeEventError } from "./unconfigured-stripe-event-error";
import { type StripeEvent, verifyStripeSignature } from "./verify-stripe-signature";

export type StripeEventHandler = (input: {
	stripeEvent: StripeEvent;
	logger: HutchLogger;
}) => Promise<void>;

function isWiredEventType(
	handlers: Record<StripeEventType, StripeEventHandler>,
	type: string,
): type is StripeEventType {
	return Object.hasOwn(handlers, type);
}

export function initStripeWebhookReceiverHandler(deps: {
	webhookSecret: string;
	logger: HutchLogger;
	now: () => Date;
	eventHandlers: Record<StripeEventType, StripeEventHandler>;
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
		if (!isWiredEventType(deps.eventHandlers, stripeEvent.type)) {
			throw new UnconfiguredStripeEventError(stripeEvent.type);
		}

		await deps.eventHandlers[stripeEvent.type]({ stripeEvent, logger: deps.logger });
		return { statusCode: 200, body: "" };
	};
}
