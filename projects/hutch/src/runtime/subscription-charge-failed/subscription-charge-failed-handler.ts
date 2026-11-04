import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { initSqsRecordHandler } from "@packages/infra-components/runtime";
import { SubscriptionChargeFailedEvent } from "@packages/infra-components";
import type { Logger } from "@packages/logger";
import type {
	CancelSubscriptionReason,
	PublishCancelSubscriptionCommand,
	SubscriptionChargeFailedReason,
} from "@packages/provider-contracts/events";
import type { EmitSubscriptionEvent } from "../observability/subscription-events";

const cancelReasonByChargeFailure: Record<
	SubscriptionChargeFailedReason,
	CancelSubscriptionReason
> = {
	no_card_on_file: "trial_expired_no_card",
	stripe_error: "trial_expired_charge_failed",
};

export function initSubscriptionChargeFailedHandler(deps: {
	publishCancelSubscriptionCommand: PublishCancelSubscriptionCommand;
	emit: EmitSubscriptionEvent;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	return initSqsRecordHandler({
		definition: SubscriptionChargeFailedEvent,
		logger: deps.logger,
		failure: { message: "[charge-failed] record failed" },
		malformed: { policy: "retry" },
		handle: async (detail) => {
			const { userId } = detail;
			deps.logger.info("[charge-failed] dispatching cancel", {
				userId,
				reason: detail.reason,
			});
			await deps.publishCancelSubscriptionCommand({
				userId,
				reason: cancelReasonByChargeFailure[detail.reason],
			});
			deps.emit.chargeFailed({ userId, reason: detail.reason });
		},
	});
}
