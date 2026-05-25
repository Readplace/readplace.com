import type { HutchLogger } from "@packages/hutch-logger";
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

describe("initEmitSubscriptionEvent", () => {
	it("emits a charge_succeeded event carrying the subscription id so the dashboard can join back to Stripe", () => {
		const { logger, captured } = createCapturingLogger();
		const emit = initEmitSubscriptionEvent({ logger, now: NOW });

		emit.chargeSucceeded({ userId: "user-1", subscriptionId: "sub_123" });

		expect(captured).toEqual([{
			stream: "subscriptions",
			event: "charge_succeeded",
			timestamp: "2026-05-25T10:00:00.000Z",
			user_id: "user-1",
			subscription_id: "sub_123",
		}]);
	});

	it("emits a charge_failed event with the reason so the dashboard can split no_card_on_file vs stripe_error", () => {
		const { logger, captured } = createCapturingLogger();
		const emit = initEmitSubscriptionEvent({ logger, now: NOW });

		emit.chargeFailed({ userId: "user-1", reason: "no_card_on_file" });

		expect(captured).toEqual([{
			stream: "subscriptions",
			event: "charge_failed",
			timestamp: "2026-05-25T10:00:00.000Z",
			user_id: "user-1",
			reason: "no_card_on_file",
		}]);
	});

	it("emits a cancelled event with the optional subscription id present when known", () => {
		const { logger, captured } = createCapturingLogger();
		const emit = initEmitSubscriptionEvent({ logger, now: NOW });

		emit.cancelled({
			userId: "user-1",
			reason: "user_initiated_paid_confirmed",
			subscriptionId: "sub_123",
		});

		expect(captured).toEqual([{
			stream: "subscriptions",
			event: "cancelled",
			timestamp: "2026-05-25T10:00:00.000Z",
			user_id: "user-1",
			subscription_id: "sub_123",
			reason: "user_initiated_paid_confirmed",
		}]);
	});

	it("omits subscription_id from the cancelled JSON when not supplied (trial cancellations have no Stripe subscription)", () => {
		const { logger, captured } = createCapturingLogger();
		const emit = initEmitSubscriptionEvent({ logger, now: NOW });

		emit.cancelled({ userId: "user-1", reason: "user_initiated_trial" });

		expect(captured[0]).toEqual({
			stream: "subscriptions",
			event: "cancelled",
			timestamp: "2026-05-25T10:00:00.000Z",
			user_id: "user-1",
			reason: "user_initiated_trial",
		});
		expect(JSON.stringify(captured[0])).not.toContain("subscription_id");
	});
});
