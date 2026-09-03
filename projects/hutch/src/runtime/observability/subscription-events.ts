import type { UserId } from "@packages/domain/user";
import type { BillingPlan } from "@packages/provider-contracts/subscription-providers";
import type { HutchLogger } from "@packages/hutch-logger";
import { STREAMS, SUBSCRIPTION_EVENTS } from "./events";
import type { CheckoutReturnFailureReason, CheckoutVariant } from "./events";

interface SubscriptionEventBase {
	stream: typeof STREAMS.subscriptions;
	timestamp: string;
}

export type SubscriptionLogEvent =
	| (SubscriptionEventBase & {
			event: typeof SUBSCRIPTION_EVENTS.chargeSucceeded;
			user_id: UserId;
			subscription_id: string;
		})
	| (SubscriptionEventBase & {
			event: typeof SUBSCRIPTION_EVENTS.chargeFailed;
			user_id: UserId;
			reason: string;
		})
	| (SubscriptionEventBase & {
			event: typeof SUBSCRIPTION_EVENTS.cancelled;
			user_id: UserId;
			reason: string;
			subscription_id?: string;
		})
	| (SubscriptionEventBase & {
			event: typeof SUBSCRIPTION_EVENTS.checkoutStarted;
			user_id: UserId;
			variant: CheckoutVariant;
			checkout_session_id: string;
			plan: BillingPlan;
		})
	| (SubscriptionEventBase & {
			event: typeof SUBSCRIPTION_EVENTS.checkoutCompleted;
			user_id: UserId;
			subscription_id: string;
			checkout_session_id: string;
			paid_now: boolean;
			variant?: CheckoutVariant;
		})
	| (SubscriptionEventBase & {
			event: typeof SUBSCRIPTION_EVENTS.checkoutReturnFailed;
			reason: CheckoutReturnFailureReason;
			user_id?: UserId;
			checkout_session_id?: string;
		})
	| (SubscriptionEventBase & {
			event: typeof SUBSCRIPTION_EVENTS.resubscribeCompleted;
			user_id: UserId;
			subscription_id: string;
			paid_now: boolean;
			plan: BillingPlan;
		});

// Emitters build the strict union above so user_id is omissible only on
// checkout_return_failed (the pre-auth return). Consumers that read a captured
// event without narrowing on `event` see this widened superset instead.
export interface SubscriptionLogEventView {
	stream: typeof STREAMS.subscriptions;
	event: (typeof SUBSCRIPTION_EVENTS)[keyof typeof SUBSCRIPTION_EVENTS];
	timestamp: string;
	user_id?: UserId;
	subscription_id?: string;
	reason?: string;
	variant?: CheckoutVariant;
	checkout_session_id?: string;
	paid_now?: boolean;
	plan?: BillingPlan;
}

export interface EmitSubscriptionEvent {
	chargeSucceeded: (params: { userId: UserId; subscriptionId: string }) => void;
	chargeFailed: (params: { userId: UserId; reason: string }) => void;
	cancelled: (params: { userId: UserId; reason: string; subscriptionId?: string }) => void;
	checkoutStarted: (params: {
		userId: UserId;
		variant: CheckoutVariant;
		checkoutSessionId: string;
		plan: BillingPlan;
	}) => void;
	checkoutCompleted: (params: {
		userId: UserId;
		subscriptionId: string;
		checkoutSessionId: string;
		paidNow: boolean;
		variant?: CheckoutVariant;
	}) => void;
	checkoutReturnFailed: (params: {
		reason: CheckoutReturnFailureReason;
		userId?: UserId;
		checkoutSessionId?: string;
	}) => void;
	/** A cancelled subscriber resubscribed with a saved card: Stripe charges
	 * immediately, so this never passes through Stripe Checkout and has no
	 * checkout_started to pair with. Always revenue. */
	resubscribeCompleted: (params: {
		userId: UserId;
		subscriptionId: string;
		plan: BillingPlan;
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
		checkoutStarted: ({ userId, variant, checkoutSessionId, plan }) => {
			deps.logger.info({
				stream: STREAMS.subscriptions,
				event: SUBSCRIPTION_EVENTS.checkoutStarted,
				timestamp: deps.now().toISOString(),
				user_id: userId,
				variant,
				checkout_session_id: checkoutSessionId,
				plan,
			});
		},
		checkoutCompleted: ({ userId, subscriptionId, checkoutSessionId, paidNow, variant }) => {
			deps.logger.info({
				stream: STREAMS.subscriptions,
				event: SUBSCRIPTION_EVENTS.checkoutCompleted,
				timestamp: deps.now().toISOString(),
				user_id: userId,
				subscription_id: subscriptionId,
				checkout_session_id: checkoutSessionId,
				paid_now: paidNow,
				...(variant ? { variant } : {}),
			});
		},
		resubscribeCompleted: ({ userId, subscriptionId, plan }) => {
			deps.logger.info({
				stream: STREAMS.subscriptions,
				event: SUBSCRIPTION_EVENTS.resubscribeCompleted,
				timestamp: deps.now().toISOString(),
				user_id: userId,
				subscription_id: subscriptionId,
				paid_now: true,
				plan,
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
