/* c8 ignore start -- composition root, no logic to test */
import { createDynamoDocumentClient } from "@packages/storage-client";
import { Logger, consoleLogger } from "@packages/logger";
import type { StripeEventType } from "@packages/infra-components";
import {
	EventBridgeClient,
	initEventBridgePublisher,
} from "@packages/infra-components/runtime";
import { initDynamoDbSubscriptionProviders } from "./providers/subscription-providers/dynamodb-subscription-providers";
import { initHandleCustomerSubscriptionDeleted } from "./stripe-webhook-receiver/handlers/customer-subscription-deleted";
import { initHandleInvoicePaymentFailed } from "./stripe-webhook-receiver/handlers/invoice-payment-failed";
import {
	type StripeEventHandler,
	initStripeWebhookReceiverHandler,
} from "./stripe-webhook-receiver/stripe-webhook-receiver-handler";
import { readEnv } from "@packages/require-env";
import { STRIPE_WEBHOOK_RECEIVER_ENV } from "./stripe-webhook-receiver.env";

const env = readEnv(STRIPE_WEBHOOK_RECEIVER_ENV);

const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
const eventBusName = env.EVENT_BUS_NAME;
const subscriptionProvidersTable = env.DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE;

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
	"invoice.payment_failed": initHandleInvoicePaymentFailed({
		findSubscriptionBySubscriptionId: subscriptionProviders.findBySubscriptionId,
		publishEvent,
	}),
};

export const handler = initStripeWebhookReceiverHandler({
	webhookSecret,
	logger: Logger.from(consoleLogger),
	now: () => new Date(),
	eventHandlers,
});
/* c8 ignore stop */
