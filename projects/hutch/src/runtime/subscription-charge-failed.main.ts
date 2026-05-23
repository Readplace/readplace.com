/* c8 ignore start -- composition root, no logic to test */
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { initEventBridgeCancelSubscriptionCommand } from "./providers/events/eventbridge-cancel-subscription-command";
import { initSubscriptionChargeFailedHandler } from "./subscription-charge-failed/subscription-charge-failed-handler";
import { requireEnv } from "./domain/require-env";

const eventBusName = requireEnv("EVENT_BUS_NAME");

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName,
});

const { publishCancelSubscriptionCommand } = initEventBridgeCancelSubscriptionCommand({
	publishEvent,
});

export const handler = initSubscriptionChargeFailedHandler({
	publishCancelSubscriptionCommand,
	logger: HutchLogger.from(consoleLogger),
});
/* c8 ignore stop */
