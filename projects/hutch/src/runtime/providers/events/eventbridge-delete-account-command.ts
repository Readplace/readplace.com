/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { DeleteAccountCommand } from "@packages/hutch-infra-components";
import type { PublishDeleteAccountCommand } from "@packages/provider-contracts/events";

export function initEventBridgeDeleteAccountCommand(deps: {
	publishEvent: PublishEvent;
}): { publishDeleteAccountCommand: PublishDeleteAccountCommand } {
	return {
		publishDeleteAccountCommand: (params) =>
			deps.publishEvent(DeleteAccountCommand, params),
	};
}
/* c8 ignore stop */
