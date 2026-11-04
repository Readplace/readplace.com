/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import type { PublishEvent } from "@packages/infra-components/runtime";
import { LinkQueuedEvent } from "@packages/infra-components";
import type { PublishLinkQueued } from "@packages/provider-contracts/events";

export function initEventBridgeLinkQueued(deps: {
	publishEvent: PublishEvent;
}): { publishLinkQueued: PublishLinkQueued } {
	return {
		publishLinkQueued: (params) => deps.publishEvent(LinkQueuedEvent, params),
	};
}
/* c8 ignore stop */
