/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { SubscriptionChargeFailedEvent } from "@packages/hutch-infra-components";
import type { PublishSubscriptionChargeFailed } from "@packages/test-fixtures/providers/events";

export function initEventBridgeSubscriptionChargeFailed(deps: {
	publishEvent: PublishEvent;
}): { publishSubscriptionChargeFailed: PublishSubscriptionChargeFailed } {
	const { publishEvent } = deps;

	const publishSubscriptionChargeFailed: PublishSubscriptionChargeFailed = async (params) => {
		await publishEvent({
			source: SubscriptionChargeFailedEvent.source,
			detailType: SubscriptionChargeFailedEvent.detailType,
			detail: JSON.stringify(
				SubscriptionChargeFailedEvent.detailSchema.parse({
					userId: params.userId,
					reason: params.reason,
				}),
			),
		});
	};

	return { publishSubscriptionChargeFailed };
}
/* c8 ignore stop */
