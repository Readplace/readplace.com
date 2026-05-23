/* c8 ignore start -- composition root, no logic to test */
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import {
	EventBridgeClient,
	initEventBridgePublisher,
} from "@packages/hutch-infra-components/runtime";
import { initStripeWebhookReceiverHandler } from "./stripe-webhook-receiver/stripe-webhook-receiver-handler";
import { requireEnv } from "./domain/require-env";

const webhookSecret = requireEnv("STRIPE_WEBHOOK_SECRET");
const eventBusName = requireEnv("EVENT_BUS_NAME");

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName,
});

export const handler = initStripeWebhookReceiverHandler({
	webhookSecret,
	publishEvent,
	logger: HutchLogger.from(consoleLogger),
	now: () => new Date(),
});
/* c8 ignore stop */
