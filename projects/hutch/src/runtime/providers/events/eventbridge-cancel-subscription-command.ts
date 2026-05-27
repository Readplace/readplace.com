/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { CancelSubscriptionCommand } from "@packages/hutch-infra-components";
import type { PublishCancelSubscriptionCommand } from "@packages/test-fixtures/providers/events";

export function initEventBridgeCancelSubscriptionCommand(deps: {
	publishEvent: PublishEvent;
}): { publishCancelSubscriptionCommand: PublishCancelSubscriptionCommand } {
	return {
		publishCancelSubscriptionCommand: (params) =>
			deps.publishEvent(CancelSubscriptionCommand, params),
	};
}
/* c8 ignore stop */
