/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { SubscriptionReactivatedEvent } from "@packages/hutch-infra-components";
import type { PublishSubscriptionReactivated } from "@packages/test-fixtures/providers/events";

export function initEventBridgeSubscriptionReactivated(deps: {
	publishEvent: PublishEvent;
}): { publishSubscriptionReactivated: PublishSubscriptionReactivated } {
	return {
		publishSubscriptionReactivated: (params) =>
			deps.publishEvent(SubscriptionReactivatedEvent, params),
	};
}
/* c8 ignore stop */
