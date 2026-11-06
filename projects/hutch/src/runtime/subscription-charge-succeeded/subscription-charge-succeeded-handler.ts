import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { initSqsRecordHandler } from "@packages/infra-components/runtime";
import { SubscriptionChargeSucceededEvent } from "@packages/infra-components";
import type { Logger } from "@packages/logger";
import type { UpsertActiveSubscription } from "@packages/provider-contracts/subscription-providers";
import type { EmitSubscriptionEvent } from "../observability/subscription-events";

export function initSubscriptionChargeSucceededHandler(deps: {
	upsertActive: UpsertActiveSubscription;
	emit: EmitSubscriptionEvent;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	return initSqsRecordHandler({
		definition: SubscriptionChargeSucceededEvent,
		logger: deps.logger,
		failure: { message: "[charge-succeeded] record failed" },
		malformed: { policy: "retry" },
		handle: async (detail) => {
			const { userId } = detail;
			await deps.upsertActive({
				userId,
				subscriptionId: detail.subscriptionId,
				customerId: detail.customerId,
				plan: detail.plan,
			});
			deps.emit.chargeSucceeded({
				userId,
				subscriptionId: detail.subscriptionId,
			});
			deps.logger.info("[charge-succeeded] upserted active", {
				userId,
				subscriptionId: detail.subscriptionId,
			});
		},
	});
}
