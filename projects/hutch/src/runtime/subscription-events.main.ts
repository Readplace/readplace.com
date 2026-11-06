/* c8 ignore start -- composition root, no logic to test */
import { SchedulerClient } from "@aws-sdk/client-scheduler";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { EventBridgeClient, initEventBridgePublisher, initHandleByDetailType } from "@packages/infra-components/runtime";
import {
	CancelSubscriptionCommand,
	SubscriptionCancellationScheduledEvent,
	SubscriptionCancelledEvent,
	SubscriptionChargeFailedEvent,
	SubscriptionChargeSucceededEvent,
	SubscriptionStartRequestCommand,
} from "@packages/infra-components";
import { Logger, consoleLogger } from "@packages/logger";
import { initDynamoDbSubscriptionProviders } from "./providers/subscription-providers/dynamodb-subscription-providers";
import { initStripeSubscriptions } from "./providers/stripe-subscriptions/stripe-subscriptions";
import { initStripePrices } from "./providers/stripe-prices/stripe-prices";
import { initEventBridgeCancelSubscriptionCommand } from "./providers/events/eventbridge-cancel-subscription-command";
import { initEventBridgeSubscriptionCancellationScheduled } from "./providers/events/eventbridge-subscription-cancellation-scheduled";
import { initEventBridgeSubscriptionCancelled } from "./providers/events/eventbridge-subscription-cancelled";
import { initEventBridgeSubscriptionChargeFailed } from "./providers/events/eventbridge-subscription-charge-failed";
import { initEventBridgeSubscriptionChargeSucceeded } from "./providers/events/eventbridge-subscription-charge-succeeded";
import { initAwsTrialScheduler } from "./providers/trial-scheduler/aws-trial-scheduler";
import { initCancelSubscriptionHandler } from "./cancel-subscription/cancel-subscription-handler";
import { initHandleSubscriptionCancellationScheduledHandler } from "./handle-subscription-cancellation-scheduled/handle-subscription-cancellation-scheduled-handler";
import { initHandleSubscriptionCancelledHandler } from "./handle-subscription-cancelled/handle-subscription-cancelled-handler";
import { initScheduleTrialFeedbackEmailHandler } from "./schedule-trial-feedback-email/schedule-trial-feedback-email-handler";
import { initSubscriptionChargeFailedHandler } from "./subscription-charge-failed/subscription-charge-failed-handler";
import { initSubscriptionChargeSucceededHandler } from "./subscription-charge-succeeded/subscription-charge-succeeded-handler";
import { initSubscriptionStartRequestHandler } from "./subscription-start-request/subscription-start-request-handler";
import { initEmitSubscriptionEvent, type SubscriptionLogEvent } from "./observability/subscription-events";
import { readEnv } from "@packages/require-env";
import { SUBSCRIPTION_EVENTS_ENV } from "./subscription-events.env";

const env = readEnv(SUBSCRIPTION_EVENTS_ENV);

const logger = Logger.from(consoleLogger);
const now = () => new Date();

const subscriptionProviders = initDynamoDbSubscriptionProviders({
	client: createDynamoDocumentClient(),
	tableName: env.DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE,
	now,
});

const stripeSubscriptions = initStripeSubscriptions({
	apiKey: env.STRIPE_SECRET_KEY,
	fetch: globalThis.fetch,
});

const stripePrices = initStripePrices({
	apiKey: env.STRIPE_SECRET_KEY,
	fetch: globalThis.fetch,
});

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName: env.EVENT_BUS_NAME,
});

const trialScheduler = initAwsTrialScheduler({
	client: new SchedulerClient({}),
	scheduleGroupName: env.TRIAL_SCHEDULER_GROUP_NAME,
	schedulerRoleArn: env.TRIAL_SCHEDULER_ROLE_ARN,
	eventBusArn: env.EVENT_BUS_ARN,
});

const emit = initEmitSubscriptionEvent({
	logger: Logger.fromJSON<SubscriptionLogEvent>(),
	now,
});

const { publishCancelSubscriptionCommand } = initEventBridgeCancelSubscriptionCommand({ publishEvent });
const { publishSubscriptionCancellationScheduled } =
	initEventBridgeSubscriptionCancellationScheduled({ publishEvent });
const { publishSubscriptionCancelled } = initEventBridgeSubscriptionCancelled({ publishEvent });
const { publishSubscriptionChargeFailed } = initEventBridgeSubscriptionChargeFailed({ publishEvent });
const { publishSubscriptionChargeSucceeded } = initEventBridgeSubscriptionChargeSucceeded({ publishEvent });

export const handler = initHandleByDetailType({
	routes: {
		[CancelSubscriptionCommand.detailType]: [
			initCancelSubscriptionHandler({
				findSubscriptionByUserId: subscriptionProviders.findByUserId,
				scheduleCancellationAtPeriodEnd: stripeSubscriptions.scheduleCancellationAtPeriodEnd,
				createDeferredCancellationSchedule: trialScheduler.createDeferredCancellationSchedule,
				deleteTrialEndSchedule: trialScheduler.deleteTrialEndSchedule,
				deleteTrialReminderSchedule: trialScheduler.deleteTrialReminderSchedule,
				deleteChargeReminderSchedule: trialScheduler.deleteChargeReminderSchedule,
				publishSubscriptionCancellationScheduled,
				publishSubscriptionCancelled,
				logger,
			}),
		],
		[SubscriptionCancellationScheduledEvent.detailType]: [
			initHandleSubscriptionCancellationScheduledHandler({
				markPendingCancellation: subscriptionProviders.markPendingCancellation,
				logger,
			}),
		],
		[SubscriptionCancelledEvent.detailType]: [
			initHandleSubscriptionCancelledHandler({
				markCancelledByUserId: subscriptionProviders.markCancelledByUserId,
				emit,
				logger,
			}),
			initScheduleTrialFeedbackEmailHandler({
				createTrialFeedbackEmailSchedule: trialScheduler.createTrialFeedbackEmailSchedule,
				deleteTrialFeedbackEmailSchedule: trialScheduler.deleteTrialFeedbackEmailSchedule,
				now,
				logger,
			}),
		],
		[SubscriptionChargeFailedEvent.detailType]: [
			initSubscriptionChargeFailedHandler({
				publishCancelSubscriptionCommand,
				emit,
				logger,
			}),
		],
		[SubscriptionChargeSucceededEvent.detailType]: [
			initSubscriptionChargeSucceededHandler({
				upsertActive: subscriptionProviders.upsertActive,
				emit,
				logger,
			}),
		],
		[SubscriptionStartRequestCommand.detailType]: [
			initSubscriptionStartRequestHandler({
				findSubscriptionByUserId: subscriptionProviders.findByUserId,
				createSubscriptionOnExistingCustomer: stripeSubscriptions.createSubscriptionOnExistingCustomer,
				publishSubscriptionChargeSucceeded,
				publishSubscriptionChargeFailed,
				resolvePriceId: stripePrices.resolvePriceId,
				logger,
			}),
		],
	},
	logger,
});
/* c8 ignore stop */
