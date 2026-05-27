/* c8 ignore start -- composition root, no logic to test */
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { initDynamoDbSubscriptionProviders } from "./providers/subscription-providers/dynamodb-subscription-providers";
import { initSubscriptionChargeSucceededHandler } from "./subscription-charge-succeeded/subscription-charge-succeeded-handler";
import { initEmitSubscriptionEvent, type SubscriptionLogEvent } from "./observability/subscription-events";
import { requireEnv } from "./domain/require-env";

const subscriptionProvidersTable = requireEnv("DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE");

const client = createDynamoDocumentClient();
const subscriptionProviders = initDynamoDbSubscriptionProviders({
	client,
	tableName: subscriptionProvidersTable,
	now: () => new Date(),
});

const emit = initEmitSubscriptionEvent({
	logger: HutchLogger.fromJSON<SubscriptionLogEvent>(),
	now: () => new Date(),
});

export const handler = initSubscriptionChargeSucceededHandler({
	upsertActive: subscriptionProviders.upsertActive,
	emit,
	logger: HutchLogger.from(consoleLogger),
});
/* c8 ignore stop */
