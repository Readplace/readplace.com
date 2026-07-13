import { UserIdSchema } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import { CHECKOUT_RETURN_FAILURE_REASONS, CHECKOUT_VARIANTS } from "./events";
import { initEmitSubscriptionEvent, type SubscriptionLogEvent } from "./subscription-events";

function createCapturingLogger(): {
	logger: HutchLogger.Typed<SubscriptionLogEvent>;
	captured: SubscriptionLogEvent[];
} {
	const captured: SubscriptionLogEvent[] = [];
	const logger: HutchLogger.Typed<SubscriptionLogEvent> = {
		info: (data) => { captured.push(data); },
		error: () => {},
		warn: () => {},
		debug: () => {},
	};
	return { logger, captured };
}

const NOW = () => new Date("2026-05-25T10:00:00.000Z");
const USER_ID = UserIdSchema.parse("user-1");

describe("initEmitSubscriptionEvent", () => {
	it("emits a charge_succeeded event carrying the subscription id so the dashboard can join back to Stripe", () => {
		const { logger, captured } = createCapturingLogger();
		const emit = initEmitSubscriptionEvent({ logger, now: NOW });

		emit.chargeSucceeded({ userId: USER_ID, subscriptionId: "sub_123" });

		expect(captured).toEqual([{
			stream: "subscriptions",
			event: "charge_succeeded",
			timestamp: "2026-05-25T10:00:00.000Z",
			user_id: USER_ID,
			subscription_id: "sub_123",
		}]);
	});

	it("emits a charge_failed event with the reason so the dashboard can split no_card_on_file vs stripe_error", () => {
		const { logger, captured } = createCapturingLogger();
		const emit = initEmitSubscriptionEvent({ logger, now: NOW });

		emit.chargeFailed({ userId: USER_ID, reason: "no_card_on_file" });

		expect(captured).toEqual([{
			stream: "subscriptions",
			event: "charge_failed",
			timestamp: "2026-05-25T10:00:00.000Z",
			user_id: USER_ID,
			reason: "no_card_on_file",
		}]);
	});

	it("emits a cancelled event with the optional subscription id present when known", () => {
		const { logger, captured } = createCapturingLogger();
		const emit = initEmitSubscriptionEvent({ logger, now: NOW });

		emit.cancelled({
			userId: USER_ID,
			reason: "user_initiated_paid_confirmed",
			subscriptionId: "sub_123",
		});

		expect(captured).toEqual([{
			stream: "subscriptions",
			event: "cancelled",
			timestamp: "2026-05-25T10:00:00.000Z",
			user_id: USER_ID,
			subscription_id: "sub_123",
			reason: "user_initiated_paid_confirmed",
		}]);
	});

	it("omits subscription_id from the cancelled JSON when not supplied (trial cancellations have no Stripe subscription)", () => {
		const { logger, captured } = createCapturingLogger();
		const emit = initEmitSubscriptionEvent({ logger, now: NOW });

		emit.cancelled({ userId: USER_ID, reason: "user_initiated_trial" });

		expect(captured[0]).toEqual({
			stream: "subscriptions",
			event: "cancelled",
			timestamp: "2026-05-25T10:00:00.000Z",
			user_id: USER_ID,
			reason: "user_initiated_trial",
		});
	});

	it("emits a checkout_started event carrying the variant and checkout session id so the funnel can attribute the click", () => {
		const { logger, captured } = createCapturingLogger();
		const emit = initEmitSubscriptionEvent({ logger, now: NOW });

		emit.checkoutStarted({
			userId: USER_ID,
			variant: CHECKOUT_VARIANTS.trialCheckout,
			checkoutSessionId: "cs_test_1",
		});

		expect(captured).toEqual([{
			stream: "subscriptions",
			event: "checkout_started",
			timestamp: "2026-05-25T10:00:00.000Z",
			user_id: USER_ID,
			variant: "trial_checkout",
			checkout_session_id: "cs_test_1",
		}]);
	});

	it("emits a checkout_completed event carrying paid_now:true when Stripe collected a real charge", () => {
		const { logger, captured } = createCapturingLogger();
		const emit = initEmitSubscriptionEvent({ logger, now: NOW });

		emit.checkoutCompleted({
			userId: USER_ID,
			subscriptionId: "sub_123",
			checkoutSessionId: "cs_test_1",
			paidNow: true,
		});

		expect(captured).toEqual([{
			stream: "subscriptions",
			event: "checkout_completed",
			timestamp: "2026-05-25T10:00:00.000Z",
			user_id: USER_ID,
			subscription_id: "sub_123",
			checkout_session_id: "cs_test_1",
			paid_now: true,
		}]);
	});

	it("emits a checkout_completed event carrying paid_now:false for a $0 trial-preserving checkout (card captured, no charge)", () => {
		const { logger, captured } = createCapturingLogger();
		const emit = initEmitSubscriptionEvent({ logger, now: NOW });

		emit.checkoutCompleted({
			userId: USER_ID,
			subscriptionId: "sub_123",
			checkoutSessionId: "cs_test_1",
			paidNow: false,
		});

		expect(captured).toEqual([{
			stream: "subscriptions",
			event: "checkout_completed",
			timestamp: "2026-05-25T10:00:00.000Z",
			user_id: USER_ID,
			subscription_id: "sub_123",
			checkout_session_id: "cs_test_1",
			paid_now: false,
		}]);
	});

	it("carries the originating variant on checkout_completed so completions split by entry path without a self-join back to checkout_started", () => {
		const { logger, captured } = createCapturingLogger();
		const emit = initEmitSubscriptionEvent({ logger, now: NOW });

		emit.checkoutCompleted({
			userId: USER_ID,
			subscriptionId: "sub_123",
			checkoutSessionId: "cs_test_1",
			paidNow: true,
			variant: CHECKOUT_VARIANTS.cancelledResubscribe,
		});

		expect(captured).toEqual([{
			stream: "subscriptions",
			event: "checkout_completed",
			timestamp: "2026-05-25T10:00:00.000Z",
			user_id: USER_ID,
			subscription_id: "sub_123",
			checkout_session_id: "cs_test_1",
			paid_now: true,
			variant: "cancelled_resubscribe",
		}]);
	});

	it("emits resubscribe_completed with paid_now:true — a saved-card resubscribe charges immediately and never passes through Stripe Checkout", () => {
		const { logger, captured } = createCapturingLogger();
		const emit = initEmitSubscriptionEvent({ logger, now: NOW });

		emit.resubscribeCompleted({ userId: USER_ID, subscriptionId: "sub_resub" });

		expect(captured).toEqual([{
			stream: "subscriptions",
			event: "resubscribe_completed",
			timestamp: "2026-05-25T10:00:00.000Z",
			user_id: USER_ID,
			subscription_id: "sub_resub",
			paid_now: true,
		}]);
	});

	it("emits a checkout_return_failed event with user_id and checkout_session_id when both are known", () => {
		const { logger, captured } = createCapturingLogger();
		const emit = initEmitSubscriptionEvent({ logger, now: NOW });

		emit.checkoutReturnFailed({
			reason: CHECKOUT_RETURN_FAILURE_REASONS.notPaid,
			userId: USER_ID,
			checkoutSessionId: "cs_test_1",
		});

		expect(captured).toEqual([{
			stream: "subscriptions",
			event: "checkout_return_failed",
			timestamp: "2026-05-25T10:00:00.000Z",
			reason: "not_paid",
			user_id: USER_ID,
			checkout_session_id: "cs_test_1",
		}]);
	});

	it("omits user_id and checkout_session_id from checkout_return_failed when neither is known (anonymous return with no parseable session)", () => {
		const { logger, captured } = createCapturingLogger();
		const emit = initEmitSubscriptionEvent({ logger, now: NOW });

		emit.checkoutReturnFailed({ reason: CHECKOUT_RETURN_FAILURE_REASONS.invalidQuery });

		expect(captured[0]).toEqual({
			stream: "subscriptions",
			event: "checkout_return_failed",
			timestamp: "2026-05-25T10:00:00.000Z",
			reason: "invalid_query",
		});
	});
});
