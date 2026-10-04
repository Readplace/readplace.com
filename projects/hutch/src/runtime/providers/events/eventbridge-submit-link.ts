import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { SubmitLinkCommand } from "@packages/hutch-infra-components";
import type { PublishSubmitLink } from "@packages/provider-contracts/events";

export function initEventBridgeSubmitLink(deps: {
	publishEvent: PublishEvent;
}): { publishSubmitLink: PublishSubmitLink } {
	return {
		publishSubmitLink: (params) => deps.publishEvent(SubmitLinkCommand, params),
	};
}
