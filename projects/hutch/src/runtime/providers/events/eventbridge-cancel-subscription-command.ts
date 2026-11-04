/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import type { PublishEvent } from "@packages/infra-components/runtime";
import { CancelSubscriptionCommand } from "@packages/infra-components";
import type { PublishCancelSubscriptionCommand } from "@packages/provider-contracts/events";

export function initEventBridgeCancelSubscriptionCommand(deps: {
	publishEvent: PublishEvent;
}): { publishCancelSubscriptionCommand: PublishCancelSubscriptionCommand } {
	return {
		publishCancelSubscriptionCommand: (params) =>
			deps.publishEvent(CancelSubscriptionCommand, params),
	};
}
/* c8 ignore stop */
