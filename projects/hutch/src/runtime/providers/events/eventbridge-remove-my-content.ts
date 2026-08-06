/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { RemoveMyContentCommand } from "@packages/hutch-infra-components";
import type { PublishRemoveMyContent } from "@packages/provider-contracts/events";

export function initEventBridgeRemoveMyContent(deps: {
	publishEvent: PublishEvent;
}): { publishRemoveMyContent: PublishRemoveMyContent } {
	return {
		publishRemoveMyContent: (params) =>
			deps.publishEvent(RemoveMyContentCommand, params),
	};
}
/* c8 ignore stop */
