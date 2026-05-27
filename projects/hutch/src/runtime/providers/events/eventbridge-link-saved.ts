/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { SaveLinkCommand } from "@packages/hutch-infra-components";
import type { PublishLinkSaved } from "@packages/test-fixtures/providers/events";

export function initEventBridgeLinkSaved(deps: {
	publishEvent: PublishEvent;
}): { publishLinkSaved: PublishLinkSaved } {
	return {
		publishLinkSaved: (params) => deps.publishEvent(SaveLinkCommand, params),
	};
}
/* c8 ignore stop */
