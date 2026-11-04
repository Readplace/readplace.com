import { ComputeRelatedPassesCommand } from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";
import type { PublishComputeRelatedPasses } from "@packages/provider-contracts/events";

export function initEventBridgeComputeRelatedPasses(deps: {
	publishEvent: PublishEvent;
}): { publishComputeRelatedPasses: PublishComputeRelatedPasses } {
	return {
		publishComputeRelatedPasses: (params) =>
			deps.publishEvent(ComputeRelatedPassesCommand, params),
	};
}
