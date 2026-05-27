/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { SubscriptionChargeSucceededEvent } from "@packages/hutch-infra-components";
import type { PublishSubscriptionChargeSucceeded } from "@packages/test-fixtures/providers/events";

export function initEventBridgeSubscriptionChargeSucceeded(deps: {
	publishEvent: PublishEvent;
}): { publishSubscriptionChargeSucceeded: PublishSubscriptionChargeSucceeded } {
	return {
		publishSubscriptionChargeSucceeded: (params) =>
			deps.publishEvent(SubscriptionChargeSucceededEvent, params),
	};
}
/* c8 ignore stop */
