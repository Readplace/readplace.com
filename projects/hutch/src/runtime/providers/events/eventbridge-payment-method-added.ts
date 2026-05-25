/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { PaymentMethodAddedEvent } from "@packages/hutch-infra-components";
import type { PublishPaymentMethodAdded } from "@packages/test-fixtures/providers/events";

export function initEventBridgePaymentMethodAdded(deps: {
	publishEvent: PublishEvent;
}): { publishPaymentMethodAdded: PublishPaymentMethodAdded } {
	const { publishEvent } = deps;

	const publishPaymentMethodAdded: PublishPaymentMethodAdded = async (params) => {
		await publishEvent({
			source: PaymentMethodAddedEvent.source,
			detailType: PaymentMethodAddedEvent.detailType,
			detail: JSON.stringify(
				PaymentMethodAddedEvent.detailSchema.parse({
					userId: params.userId,
				}),
			),
		});
	};

	return { publishPaymentMethodAdded };
}
/* c8 ignore stop */
