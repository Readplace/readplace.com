/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { SaveAnonymousLinkCommand } from "@packages/hutch-infra-components";
import type { PublishSaveAnonymousLink } from "@packages/test-fixtures/providers/events";

export function initEventBridgeSaveAnonymousLink(deps: {
	publishEvent: PublishEvent;
}): { publishSaveAnonymousLink: PublishSaveAnonymousLink } {
	return {
		publishSaveAnonymousLink: (params) =>
			deps.publishEvent(SaveAnonymousLinkCommand, params),
	};
}
/* c8 ignore stop */
