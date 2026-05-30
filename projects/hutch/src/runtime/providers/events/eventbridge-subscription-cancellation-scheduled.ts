/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { SubscriptionCancellationScheduledEvent } from "@packages/hutch-infra-components";
import type { PublishSubscriptionCancellationScheduled } from "@packages/test-fixtures/providers/events";

export function initEventBridgeSubscriptionCancellationScheduled(deps: {
	publishEvent: PublishEvent;
}): { publishSubscriptionCancellationScheduled: PublishSubscriptionCancellationScheduled } {
	return {
		publishSubscriptionCancellationScheduled: (params) =>
			deps.publishEvent(SubscriptionCancellationScheduledEvent, params),
	};
}
/* c8 ignore stop */
