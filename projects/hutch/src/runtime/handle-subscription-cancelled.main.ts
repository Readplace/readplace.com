/* c8 ignore start -- composition root, no logic to test */
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { initDynamoDbSubscriptionProviders } from "./providers/subscription-providers/dynamodb-subscription-providers";
import { initHandleSubscriptionCancelledHandler } from "./handle-subscription-cancelled/handle-subscription-cancelled-handler";
import { requireEnv } from "./domain/require-env";

const subscriptionProvidersTable = requireEnv("DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE");

const client = createDynamoDocumentClient();
const subscriptionProviders = initDynamoDbSubscriptionProviders({
	client,
	tableName: subscriptionProvidersTable,
	now: () => new Date(),
});

export const handler = initHandleSubscriptionCancelledHandler({
	markCancelledByUserId: subscriptionProviders.markCancelledByUserId,
	logger: HutchLogger.from(consoleLogger),
});
/* c8 ignore stop */
