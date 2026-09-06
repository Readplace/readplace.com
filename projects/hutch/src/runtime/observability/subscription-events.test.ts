import { UserIdSchema } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import { CHECKOUT_RETURN_FAILURE_REASONS, CHECKOUT_VARIANTS } from "./events";
import {
	buildCheckoutCompletedEvent,
	buildCheckoutReturnFailedEvent,
	buildCheckoutStartedEvent,
	buildResubscribeCompletedEvent,
	initEmitSubscriptionEvent,
	type SubscriptionLogEvent,
} from "./subscription-events";

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
});

describe("buildCheckoutStartedEvent", () => {
	it("carries the variant and checkout session id so the funnel can attribute the click", () => {
		expect(buildCheckoutStartedEvent({ now: NOW }, {
			userId: USER_ID,
			variant: CHECKOUT_VARIANTS.trialCheckout,
			checkoutSessionId: "cs_test_1",
			plan: "triennial",
		})).toEqual({
			stream: "subscriptions",
			event: "checkout_started",
			timestamp: "2026-05-25T10:00:00.000Z",
			user_id: USER_ID,
			variant: "trial_checkout",
			checkout_session_id: "cs_test_1",
			plan: "triennial",
		});
	});
});

describe("buildCheckoutCompletedEvent", () => {
	it("carries paid_now:true when Stripe collected a real charge", () => {
		expect(buildCheckoutCompletedEvent({ now: NOW }, {
			userId: USER_ID,
			subscriptionId: "sub_123",
			checkoutSessionId: "cs_test_1",
			paidNow: true,
		})).toEqual({
			stream: "subscriptions",
			event: "checkout_completed",
			timestamp: "2026-05-25T10:00:00.000Z",
			user_id: USER_ID,
			subscription_id: "sub_123",
			checkout_session_id: "cs_test_1",
			paid_now: true,
		});
	});

	it("carries paid_now:false for a $0 trial-preserving checkout (card captured, no charge)", () => {
		expect(buildCheckoutCompletedEvent({ now: NOW }, {
			userId: USER_ID,
			subscriptionId: "sub_123",
			checkoutSessionId: "cs_test_1",
			paidNow: false,
		})).toEqual({
			stream: "subscriptions",
			event: "checkout_completed",
			timestamp: "2026-05-25T10:00:00.000Z",
			user_id: USER_ID,
			subscription_id: "sub_123",
			checkout_session_id: "cs_test_1",
			paid_now: false,
		});
	});

	it("carries the originating variant so completions split by entry path without a self-join back to checkout_started", () => {
		expect(buildCheckoutCompletedEvent({ now: NOW }, {
			userId: USER_ID,
			subscriptionId: "sub_123",
			checkoutSessionId: "cs_test_1",
			paidNow: true,
			variant: CHECKOUT_VARIANTS.cancelledResubscribe,
		})).toEqual({
			stream: "subscriptions",
			event: "checkout_completed",
			timestamp: "2026-05-25T10:00:00.000Z",
			user_id: USER_ID,
			subscription_id: "sub_123",
			checkout_session_id: "cs_test_1",
			paid_now: true,
			variant: "cancelled_resubscribe",
		});
	});
});

describe("buildResubscribeCompletedEvent", () => {
	it("carries paid_now:true — a saved-card resubscribe charges immediately and never passes through Stripe Checkout", () => {
		expect(buildResubscribeCompletedEvent({ now: NOW }, {
			userId: USER_ID,
			subscriptionId: "sub_resub",
			plan: "monthly",
		})).toEqual({
			stream: "subscriptions",
			event: "resubscribe_completed",
			timestamp: "2026-05-25T10:00:00.000Z",
			user_id: USER_ID,
			subscription_id: "sub_resub",
			paid_now: true,
			plan: "monthly",
		});
	});
});

describe("buildCheckoutReturnFailedEvent", () => {
	it("carries user_id and checkout_session_id when both are known", () => {
		expect(buildCheckoutReturnFailedEvent({ now: NOW }, {
			reason: CHECKOUT_RETURN_FAILURE_REASONS.notPaid,
			userId: USER_ID,
			checkoutSessionId: "cs_test_1",
		})).toEqual({
			stream: "subscriptions",
			event: "checkout_return_failed",
			timestamp: "2026-05-25T10:00:00.000Z",
			reason: "not_paid",
			user_id: USER_ID,
			checkout_session_id: "cs_test_1",
		});
	});

	it("omits user_id and checkout_session_id when neither is known (anonymous return with no parseable session)", () => {
		expect(buildCheckoutReturnFailedEvent({ now: NOW }, {
			reason: CHECKOUT_RETURN_FAILURE_REASONS.invalidQuery,
		})).toEqual({
			stream: "subscriptions",
			event: "checkout_return_failed",
			timestamp: "2026-05-25T10:00:00.000Z",
			reason: "invalid_query",
		});
	});
});
