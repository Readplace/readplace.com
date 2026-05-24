/* c8 ignore start -- composition root, no logic to test */
import { SchedulerClient } from "@aws-sdk/client-scheduler";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { initDynamoDbSubscriptionProviders } from "./providers/subscription-providers/dynamodb-subscription-providers";
import { initStripeSubscriptions } from "./providers/stripe-subscriptions/stripe-subscriptions";
import { initEventBridgeSubscriptionCancelled } from "./providers/events/eventbridge-subscription-cancelled";
import { initAwsTrialScheduler } from "./providers/trial-scheduler/aws-trial-scheduler";
import { initCancelSubscriptionHandler } from "./cancel-subscription/cancel-subscription-handler";
import { requireEnv } from "./domain/require-env";

const subscriptionProvidersTable = requireEnv("DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE");
const stripeApiKey = requireEnv("STRIPE_SECRET_KEY");
const eventBusName = requireEnv("EVENT_BUS_NAME");
const trialSchedulerGroupName = requireEnv("TRIAL_SCHEDULER_GROUP_NAME");

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

const { publishSubscriptionCancelled } = initEventBridgeSubscriptionCancelled({ publishEvent });

const trialScheduler = initAwsTrialScheduler({
	client: new SchedulerClient({}),
	scheduleGroupName: trialSchedulerGroupName,
});

export const handler = initCancelSubscriptionHandler({
	findSubscriptionByUserId: subscriptionProviders.findByUserId,
	cancelStripeSubscriptionImmediately: stripeSubscriptions.cancelImmediately,
	publishSubscriptionCancelled,
	deleteTrialEndSchedule: trialScheduler.deleteTrialEndSchedule,
	logger: HutchLogger.from(consoleLogger),
});
/* c8 ignore stop */
