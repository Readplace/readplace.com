/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import { ComputeRelatedPastReadsCommand } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { PublishComputeRelatedPastReads } from "@packages/provider-contracts/events";

export function initEventBridgeComputeRelatedPastReads(deps: {
	publishEvent: PublishEvent;
}): { publishComputeRelatedPastReads: PublishComputeRelatedPastReads } {
	return {
		publishComputeRelatedPastReads: (params) =>
			deps.publishEvent(ComputeRelatedPastReadsCommand, params),
	};
}
/* c8 ignore stop */
