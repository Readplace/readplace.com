/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { UpdateFetchTimestampCommand } from "@packages/hutch-infra-components";
import type { PublishUpdateFetchTimestamp } from "@packages/test-fixtures/providers/events";

export function initEventBridgeUpdateFetchTimestamp(deps: {
	publishEvent: PublishEvent;
}): { publishUpdateFetchTimestamp: PublishUpdateFetchTimestamp } {
	return {
		publishUpdateFetchTimestamp: (params) =>
			deps.publishEvent(UpdateFetchTimestampCommand, params),
	};
}
/* c8 ignore stop */
