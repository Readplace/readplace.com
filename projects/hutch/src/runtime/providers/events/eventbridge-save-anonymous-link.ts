/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import type { PublishEvent } from "@packages/infra-components/runtime";
import { SaveAnonymousLinkCommand } from "@packages/infra-components";
import type { PublishSaveAnonymousLink } from "@packages/provider-contracts/events";

export function initEventBridgeSaveAnonymousLink(deps: {
	publishEvent: PublishEvent;
}): { publishSaveAnonymousLink: PublishSaveAnonymousLink } {
	return {
		publishSaveAnonymousLink: (params) =>
			deps.publishEvent(SaveAnonymousLinkCommand, params),
	};
}
/* c8 ignore stop */
