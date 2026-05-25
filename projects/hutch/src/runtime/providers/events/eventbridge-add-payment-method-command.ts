/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { AddPaymentMethodCommand } from "@packages/hutch-infra-components";
import type { PublishAddPaymentMethodCommand } from "@packages/test-fixtures/providers/events";

export function initEventBridgeAddPaymentMethodCommand(deps: {
	publishEvent: PublishEvent;
}): { publishAddPaymentMethodCommand: PublishAddPaymentMethodCommand } {
	const { publishEvent } = deps;

	const publishAddPaymentMethodCommand: PublishAddPaymentMethodCommand = async (params) => {
		await publishEvent({
			source: AddPaymentMethodCommand.source,
			detailType: AddPaymentMethodCommand.detailType,
			detail: JSON.stringify(
				AddPaymentMethodCommand.detailSchema.parse({
					userId: params.userId,
					customerId: params.customerId,
					paymentMethodId: params.paymentMethodId,
					brand: params.brand,
					last4: params.last4,
				}),
			),
		});
	};

	return { publishAddPaymentMethodCommand };
}
/* c8 ignore stop */
