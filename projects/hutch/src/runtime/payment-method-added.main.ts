/* c8 ignore start -- composition root, no logic to test */
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { initDynamoDbSubscriptionProviders } from "./providers/subscription-providers/dynamodb-subscription-providers";
import { initEventBridgeSubscriptionStartRequestCommand } from "./providers/events/eventbridge-subscription-start-request-command";
import { initPaymentMethodAddedHandler } from "./payment-method-added/payment-method-added-handler";
import { requireEnv } from "./domain/require-env";

const subscriptionProvidersTable = requireEnv("DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE");
const eventBusName = requireEnv("EVENT_BUS_NAME");

const subscriptionProviders = initDynamoDbSubscriptionProviders({
	client: createDynamoDocumentClient(),
	tableName: subscriptionProvidersTable,
	now: () => new Date(),
});

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName,
});

const { publishSubscriptionStartRequestCommand } = initEventBridgeSubscriptionStartRequestCommand({
	publishEvent,
});

export const handler = initPaymentMethodAddedHandler({
	findByUserIdConsistent: subscriptionProviders.findByUserIdConsistent,
	publishSubscriptionStartRequestCommand,
	logger: HutchLogger.from(consoleLogger),
});
/* c8 ignore stop */
