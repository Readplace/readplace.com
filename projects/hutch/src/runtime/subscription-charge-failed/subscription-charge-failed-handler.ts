import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { EventEnvelope } from "@packages/domain/event-envelope";
import { initSqsRecordHandler } from "@packages/infra-components/runtime";
import { SubscriptionChargeFailedEvent } from "@packages/infra-components";
import type { Logger } from "@packages/logger";
import type { FindSubscriptionByUserId } from "@packages/provider-contracts/subscription-providers";
import { messagePredatesStatus } from "@packages/subscription-access";
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
	findSubscriptionByUserId: FindSubscriptionByUserId;
	publishCancelSubscriptionCommand: PublishCancelSubscriptionCommand;
	emit: EmitSubscriptionEvent;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	return initSqsRecordHandler({
		definition: SubscriptionChargeFailedEvent,
		logger: deps.logger,
		failure: { message: "[charge-failed] record failed" },
		malformed: { policy: "retry" },
		handle: async (detail, record) => {
			const { userId } = detail;
			const { time: eventTime } = EventEnvelope.parse(JSON.parse(record.body));
			const row = await deps.findSubscriptionByUserId(userId);
			if (messagePredatesStatus({ statusEnteredAt: row?.statusEnteredAt, eventTime })) {
				deps.logger.info("[charge-failed] message predates row status — noop", {
					userId,
					eventTime,
					status: row?.status,
				});
				return;
			}
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
