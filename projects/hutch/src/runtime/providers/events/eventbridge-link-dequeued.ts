/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { LinkDequeuedEvent } from "@packages/hutch-infra-components";
import type { PublishLinkDequeued } from "@packages/provider-contracts/events";

export function initEventBridgeLinkDequeued(deps: {
	publishEvent: PublishEvent;
}): { publishLinkDequeued: PublishLinkDequeued } {
	return {
		publishLinkDequeued: (params) => deps.publishEvent(LinkDequeuedEvent, params),
	};
}
/* c8 ignore stop */
