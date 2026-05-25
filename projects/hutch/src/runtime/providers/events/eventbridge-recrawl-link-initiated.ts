/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { RecrawlLinkInitiatedEvent } from "@packages/hutch-infra-components";
import type { PublishRecrawlLinkInitiated } from "@packages/test-fixtures/providers/events";

export function initEventBridgeRecrawlLinkInitiated(deps: {
	publishEvent: PublishEvent;
}): { publishRecrawlLinkInitiated: PublishRecrawlLinkInitiated } {
	return {
		publishRecrawlLinkInitiated: (params) =>
			deps.publishEvent(RecrawlLinkInitiatedEvent, params),
	};
}
/* c8 ignore stop */
