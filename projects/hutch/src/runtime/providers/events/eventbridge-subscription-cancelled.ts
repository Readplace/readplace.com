/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { SubscriptionCancelledEvent } from "@packages/hutch-infra-components";
import type { PublishSubscriptionCancelled } from "@packages/test-fixtures/providers/events";

export function initEventBridgeSubscriptionCancelled(deps: {
	publishEvent: PublishEvent;
}): { publishSubscriptionCancelled: PublishSubscriptionCancelled } {
	const { publishEvent } = deps;

	const publishSubscriptionCancelled: PublishSubscriptionCancelled = async (params) => {
		await publishEvent({
			source: SubscriptionCancelledEvent.source,
			detailType: SubscriptionCancelledEvent.detailType,
			detail: JSON.stringify(
				SubscriptionCancelledEvent.detailSchema.parse({
					userId: params.userId,
					subscriptionId: params.subscriptionId,
					reason: params.reason,
				}),
			),
		});
	};

	return { publishSubscriptionCancelled };
}
/* c8 ignore stop */
