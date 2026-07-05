import type { UserId } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import { STREAMS, SUBSCRIPTION_EVENTS } from "./events";
import type { CheckoutReturnFailureReason, CheckoutVariant } from "./events";

export interface SubscriptionLogEvent {
	stream: typeof STREAMS.subscriptions;
	event: (typeof SUBSCRIPTION_EVENTS)[keyof typeof SUBSCRIPTION_EVENTS];
	timestamp: string;
	user_id?: UserId;
	subscription_id?: string;
	reason?: string;
	variant?: CheckoutVariant;
	checkout_session_id?: string;
}

export interface EmitSubscriptionEvent {
	chargeSucceeded: (params: { userId: UserId; subscriptionId: string }) => void;
	chargeFailed: (params: { userId: UserId; reason: string }) => void;
	cancelled: (params: { userId: UserId; reason: string; subscriptionId?: string }) => void;
	checkoutStarted: (params: {
		userId: UserId;
		variant: CheckoutVariant;
		checkoutSessionId: string;
	}) => void;
	checkoutCompleted: (params: {
		userId: UserId;
		subscriptionId: string;
		checkoutSessionId: string;
	}) => void;
	checkoutReturnFailed: (params: {
		reason: CheckoutReturnFailureReason;
		userId?: UserId;
		checkoutSessionId?: string;
	}) => void;
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
		checkoutStarted: ({ userId, variant, checkoutSessionId }) => {
			deps.logger.info({
				stream: STREAMS.subscriptions,
				event: SUBSCRIPTION_EVENTS.checkoutStarted,
				timestamp: deps.now().toISOString(),
				user_id: userId,
				variant,
				checkout_session_id: checkoutSessionId,
			});
		},
		checkoutCompleted: ({ userId, subscriptionId, checkoutSessionId }) => {
			deps.logger.info({
				stream: STREAMS.subscriptions,
				event: SUBSCRIPTION_EVENTS.checkoutCompleted,
				timestamp: deps.now().toISOString(),
				user_id: userId,
				subscription_id: subscriptionId,
				checkout_session_id: checkoutSessionId,
			});
		},
		checkoutReturnFailed: ({ reason, userId, checkoutSessionId }) => {
			deps.logger.info({
				stream: STREAMS.subscriptions,
				event: SUBSCRIPTION_EVENTS.checkoutReturnFailed,
				timestamp: deps.now().toISOString(),
				reason,
				...(userId ? { user_id: userId } : {}),
				...(checkoutSessionId ? { checkout_session_id: checkoutSessionId } : {}),
			});
		},
	};
}
