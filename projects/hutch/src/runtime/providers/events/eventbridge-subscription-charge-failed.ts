/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { SubscriptionChargeFailedEvent } from "@packages/hutch-infra-components";
import type { PublishSubscriptionChargeFailed } from "@packages/test-fixtures/providers/events";

export function initEventBridgeSubscriptionChargeFailed(deps: {
	publishEvent: PublishEvent;
}): { publishSubscriptionChargeFailed: PublishSubscriptionChargeFailed } {
	return {
		publishSubscriptionChargeFailed: (params) =>
			deps.publishEvent(SubscriptionChargeFailedEvent, params),
	};
}
/* c8 ignore stop */
