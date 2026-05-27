/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { SubscriptionCancelledEvent } from "@packages/hutch-infra-components";
import type { PublishSubscriptionCancelled } from "@packages/test-fixtures/providers/events";

export function initEventBridgeSubscriptionCancelled(deps: {
	publishEvent: PublishEvent;
}): { publishSubscriptionCancelled: PublishSubscriptionCancelled } {
	return {
		publishSubscriptionCancelled: (params) =>
			deps.publishEvent(SubscriptionCancelledEvent, params),
	};
}
/* c8 ignore stop */
