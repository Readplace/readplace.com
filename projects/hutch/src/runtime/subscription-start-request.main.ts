/* c8 ignore start -- composition root, no logic to test */
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { initDynamoDbSubscriptionProviders } from "./providers/subscription-providers/dynamodb-subscription-providers";
import { initStripeSubscriptions } from "./providers/stripe-subscriptions/stripe-subscriptions";
import { initEventBridgeSubscriptionChargeSucceeded } from "./providers/events/eventbridge-subscription-charge-succeeded";
import { initEventBridgeSubscriptionChargeFailed } from "./providers/events/eventbridge-subscription-charge-failed";
import { initSubscriptionStartRequestHandler } from "./subscription-start-request/subscription-start-request-handler";
import { requireEnv } from "./domain/require-env";

const subscriptionProvidersTable = requireEnv("DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE");
const stripeApiKey = requireEnv("STRIPE_SECRET_KEY");
const stripePriceId = requireEnv("STRIPE_PRICE_ID");
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

const { publishSubscriptionChargeSucceeded } = initEventBridgeSubscriptionChargeSucceeded({
	publishEvent,
});
const { publishSubscriptionChargeFailed } = initEventBridgeSubscriptionChargeFailed({
	publishEvent,
});

export const handler = initSubscriptionStartRequestHandler({
	findSubscriptionByUserId: subscriptionProviders.findByUserId,
	createSubscriptionOnExistingCustomer: stripeSubscriptions.createSubscriptionOnExistingCustomer,
	publishSubscriptionChargeSucceeded,
	publishSubscriptionChargeFailed,
	stripePriceId,
	logger: HutchLogger.from(consoleLogger),
});
/* c8 ignore stop */
