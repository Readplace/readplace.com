/* c8 ignore start -- composition root, no logic to test */
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { initDynamoDbSubscriptionProviders } from "./providers/subscription-providers/dynamodb-subscription-providers";
import { initStripeSubscriptions } from "./providers/stripe-subscriptions/stripe-subscriptions";
import { initEventBridgePaymentMethodAdded } from "./providers/events/eventbridge-payment-method-added";
import { initAddPaymentMethodHandler } from "./add-payment-method/add-payment-method-handler";
import { requireEnv } from "./domain/require-env";

const subscriptionProvidersTable = requireEnv("DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE");
const stripeApiKey = requireEnv("STRIPE_SECRET_KEY");
const eventBusName = requireEnv("EVENT_BUS_NAME");

const subscriptionProviders = initDynamoDbSubscriptionProviders({
	client: createDynamoDocumentClient(),
	tableName: subscriptionProvidersTable,
	now: () => new Date(),
});

const stripeSubscriptions = initStripeSubscriptions({
	apiKey: stripeApiKey,
	fetch: globalThis.fetch,
});

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName,
});

const { publishPaymentMethodAdded } = initEventBridgePaymentMethodAdded({ publishEvent });

export const handler = initAddPaymentMethodHandler({
	upsertPaymentMethod: subscriptionProviders.upsertPaymentMethod,
	setDefaultPaymentMethod: stripeSubscriptions.setDefaultPaymentMethod,
	publishPaymentMethodAdded,
	logger: HutchLogger.from(consoleLogger),
});
/* c8 ignore stop */
