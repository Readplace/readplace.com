/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { StaleCheckRequestedEvent } from "@packages/hutch-infra-components";
import type { PublishStaleCheckRequested } from "@packages/test-fixtures/providers/events";

export function initEventBridgeStaleCheckRequested(deps: {
	publishEvent: PublishEvent;
}): { publishStaleCheckRequested: PublishStaleCheckRequested } {
	const { publishEvent } = deps;

	const publishStaleCheckRequested: PublishStaleCheckRequested = async (params) => {
		await publishEvent({
			source: StaleCheckRequestedEvent.source,
			detailType: StaleCheckRequestedEvent.detailType,
			detail: JSON.stringify({ url: params.url }),
		});
	};

	return { publishStaleCheckRequested };
}
/* c8 ignore stop */
