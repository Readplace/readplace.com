/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { SubscriptionChargeSucceededEvent } from "@packages/hutch-infra-components";
import type { PublishSubscriptionChargeSucceeded } from "@packages/test-fixtures/providers/events";

export function initEventBridgeSubscriptionChargeSucceeded(deps: {
	publishEvent: PublishEvent;
}): { publishSubscriptionChargeSucceeded: PublishSubscriptionChargeSucceeded } {
	const { publishEvent } = deps;

	const publishSubscriptionChargeSucceeded: PublishSubscriptionChargeSucceeded = async (params) => {
		await publishEvent({
			source: SubscriptionChargeSucceededEvent.source,
			detailType: SubscriptionChargeSucceededEvent.detailType,
			detail: JSON.stringify(
				SubscriptionChargeSucceededEvent.detailSchema.parse({
					userId: params.userId,
					subscriptionId: params.subscriptionId,
					customerId: params.customerId,
				}),
			),
		});
	};

	return { publishSubscriptionChargeSucceeded };
}
/* c8 ignore stop */
