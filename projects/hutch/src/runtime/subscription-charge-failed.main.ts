/* c8 ignore start -- composition root, no logic to test */
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { initEventBridgeCancelSubscriptionCommand } from "./providers/events/eventbridge-cancel-subscription-command";
import { initSubscriptionChargeFailedHandler } from "./subscription-charge-failed/subscription-charge-failed-handler";
import { initEmitSubscriptionEvent, type SubscriptionLogEvent } from "./observability/subscription-events";
import { requireEnv } from "./domain/require-env";

const eventBusName = requireEnv("EVENT_BUS_NAME");

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName,
});

const { publishCancelSubscriptionCommand } = initEventBridgeCancelSubscriptionCommand({
	publishEvent,
});

const emit = initEmitSubscriptionEvent({
	logger: HutchLogger.fromJSON<SubscriptionLogEvent>(),
	now: () => new Date(),
});

export const handler = initSubscriptionChargeFailedHandler({
	publishCancelSubscriptionCommand,
	emit,
	logger: HutchLogger.from(consoleLogger),
});
/* c8 ignore stop */
