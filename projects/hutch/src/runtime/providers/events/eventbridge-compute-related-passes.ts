import { ComputeRelatedPassesCommand } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { PublishComputeRelatedPasses } from "@packages/provider-contracts/events";

export function initEventBridgeComputeRelatedPasses(deps: {
	publishEvent: PublishEvent;
}): { publishComputeRelatedPasses: PublishComputeRelatedPasses } {
	return {
		publishComputeRelatedPasses: (params) =>
			deps.publishEvent(ComputeRelatedPassesCommand, params),
	};
}
