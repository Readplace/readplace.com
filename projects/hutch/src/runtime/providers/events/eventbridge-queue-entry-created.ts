/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import { QueueEntryCreatedEvent } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { PublishQueueEntryCreated } from "@packages/provider-contracts/events";

export function initEventBridgeQueueEntryCreated(deps: {
	publishEvent: PublishEvent;
}): { publishQueueEntryCreated: PublishQueueEntryCreated } {
	return {
		publishQueueEntryCreated: (params) =>
			deps.publishEvent(QueueEntryCreatedEvent, params),
	};
}
/* c8 ignore stop */
