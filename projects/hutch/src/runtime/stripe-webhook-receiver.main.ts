/* c8 ignore start -- composition root, no logic to test */
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import type { StripeEventType } from "@packages/hutch-infra-components";
import {
	EventBridgeClient,
	initEventBridgePublisher,
} from "@packages/hutch-infra-components/runtime";
import { initDynamoDbSubscriptionProviders } from "./providers/subscription-providers/dynamodb-subscription-providers";
import { initHandleCustomerSubscriptionDeleted } from "./stripe-webhook-receiver/handlers/customer-subscription-deleted";
import {
	type StripeEventHandler,
	initStripeWebhookReceiverHandler,
} from "./stripe-webhook-receiver/stripe-webhook-receiver-handler";
import { requireEnv } from "./domain/require-env";

const webhookSecret = requireEnv("STRIPE_WEBHOOK_SECRET");
const eventBusName = requireEnv("EVENT_BUS_NAME");
const subscriptionProvidersTable = requireEnv("DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE");

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName,
});

const subscriptionProviders = initDynamoDbSubscriptionProviders({
	client: createDynamoDocumentClient(),
	tableName: subscriptionProvidersTable,
	now: () => new Date(),
});

const eventHandlers: Record<StripeEventType, StripeEventHandler> = {
	"customer.subscription.deleted": initHandleCustomerSubscriptionDeleted({
		findSubscriptionBySubscriptionId: subscriptionProviders.findBySubscriptionId,
		publishEvent,
	}),
};

export const handler = initStripeWebhookReceiverHandler({
	webhookSecret,
	logger: HutchLogger.from(consoleLogger),
	now: () => new Date(),
	eventHandlers,
});
/* c8 ignore stop */
