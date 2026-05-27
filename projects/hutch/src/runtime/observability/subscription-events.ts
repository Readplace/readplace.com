import type { UserId } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import { STREAMS, SUBSCRIPTION_EVENTS } from "./events";

export interface SubscriptionLogEvent {
	stream: typeof STREAMS.subscriptions;
	event: (typeof SUBSCRIPTION_EVENTS)[keyof typeof SUBSCRIPTION_EVENTS];
	timestamp: string;
	user_id: UserId;
	subscription_id?: string;
	reason?: string;
}

export interface EmitSubscriptionEvent {
	chargeSucceeded: (params: { userId: UserId; subscriptionId: string }) => void;
	chargeFailed: (params: { userId: UserId; reason: string }) => void;
	cancelled: (params: { userId: UserId; reason: string; subscriptionId?: string }) => void;
}

export function initEmitSubscriptionEvent(deps: {
	logger: HutchLogger.Typed<SubscriptionLogEvent>;
	now: () => Date;
}): EmitSubscriptionEvent {
	return {
		chargeSucceeded: ({ userId, subscriptionId }) => {
			deps.logger.info({
				stream: STREAMS.subscriptions,
				event: SUBSCRIPTION_EVENTS.chargeSucceeded,
				timestamp: deps.now().toISOString(),
				user_id: userId,
				subscription_id: subscriptionId,
			});
		},
		chargeFailed: ({ userId, reason }) => {
			deps.logger.info({
				stream: STREAMS.subscriptions,
				event: SUBSCRIPTION_EVENTS.chargeFailed,
				timestamp: deps.now().toISOString(),
				user_id: userId,
				reason,
			});
		},
		cancelled: ({ userId, reason, subscriptionId }) => {
			deps.logger.info({
				stream: STREAMS.subscriptions,
				event: SUBSCRIPTION_EVENTS.cancelled,
				timestamp: deps.now().toISOString(),
				user_id: userId,
				reason,
				...(subscriptionId ? { subscription_id: subscriptionId } : {}),
			});
		},
	};
}
