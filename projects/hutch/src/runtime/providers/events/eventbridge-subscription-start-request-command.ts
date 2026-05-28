/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { SubscriptionStartRequestCommand } from "@packages/hutch-infra-components";
import type { PublishSubscriptionStartRequestCommand } from "@packages/test-fixtures/providers/events";

export function initEventBridgeSubscriptionStartRequestCommand(deps: {
	publishEvent: PublishEvent;
}): { publishSubscriptionStartRequestCommand: PublishSubscriptionStartRequestCommand } {
	const { publishEvent } = deps;

	const publishSubscriptionStartRequestCommand: PublishSubscriptionStartRequestCommand = async (
		params,
	) => {
		await publishEvent(SubscriptionStartRequestCommand, {
			userId: params.userId,
		});
	};

	return { publishSubscriptionStartRequestCommand };
}
/* c8 ignore stop */
