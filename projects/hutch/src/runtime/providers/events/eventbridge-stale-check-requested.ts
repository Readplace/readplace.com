/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { StaleCheckRequestedEvent } from "@packages/hutch-infra-components";
import type { PublishStaleCheckRequested } from "@packages/test-fixtures/providers/events";

export function initEventBridgeStaleCheckRequested(deps: {
	publishEvent: PublishEvent;
}): { publishStaleCheckRequested: PublishStaleCheckRequested } {
	return {
		publishStaleCheckRequested: (params) =>
			deps.publishEvent(StaleCheckRequestedEvent, params),
	};
}
/* c8 ignore stop */
