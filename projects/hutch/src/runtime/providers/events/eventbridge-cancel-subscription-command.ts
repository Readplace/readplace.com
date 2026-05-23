/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { CancelSubscriptionCommand } from "@packages/hutch-infra-components";
import type { PublishCancelSubscriptionCommand } from "@packages/test-fixtures/providers/events";

export function initEventBridgeCancelSubscriptionCommand(deps: {
	publishEvent: PublishEvent;
}): { publishCancelSubscriptionCommand: PublishCancelSubscriptionCommand } {
	const { publishEvent } = deps;

	const publishCancelSubscriptionCommand: PublishCancelSubscriptionCommand = async (params) => {
		await publishEvent({
			source: CancelSubscriptionCommand.source,
			detailType: CancelSubscriptionCommand.detailType,
			detail: JSON.stringify(
				CancelSubscriptionCommand.detailSchema.parse({
					userId: params.userId,
				}),
			),
		});
	};

	return { publishCancelSubscriptionCommand };
}
/* c8 ignore stop */
