import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import type { SubscriptionRecord } from "@packages/provider-contracts/subscription-providers";
import {
	CHARGE_REMINDER_LEAD_DAYS,
	PAY_DIGEST_WINDOW_CLOSES_LEAD_MS,
	PAY_DIGEST_WINDOW_OPENS_LEAD_MS,
	STRIPE_CHECKOUT_MIN_TRIAL_END_LEAD_MS,
	TRIAL_REMINDER_LEAD_DAYS,
	chargeReminderFiresAt,
	isPayDigestDue,
	payCutoff,
	trialEndToPreserve,
	trialReminderFiresAt,
} from "./stripe-trial-config";

const DAY_MS = 86_400_000;

describe("trialReminderFiresAt", () => {
	it("subtracts exactly two days from trialEndsAt", () => {
		assert.equal(
			trialReminderFiresAt("2026-07-19T10:00:00.000Z"),
			"2026-07-17T10:00:00.000Z",
		);
	});
});

describe("chargeReminderFiresAt", () => {
	it("fires exactly 7 days before the charge — Visa requires at least 7 days' notice, Mastercard at most 7", () => {
		assert.equal(CHARGE_REMINDER_LEAD_DAYS, 7);
		assert.equal(
			chargeReminderFiresAt({
				chargeAt: "2026-07-15T00:00:00.000Z",
				now: new Date("2026-07-01T00:00:00.000Z"),
			}),
			"2026-07-08T00:00:00.000Z",
		);
	});

	it("fires within minutes when the card is attached inside the final 7 days — 7 days' notice is impossible, so send now rather than never", () => {
		const now = new Date("2026-07-01T00:00:00.000Z");
		const chargeAt = "2026-07-04T00:00:00.000Z";

		const firesAt = Date.parse(chargeReminderFiresAt({ chargeAt, now }));

		assert.ok(firesAt > now.getTime());
		assert.ok(firesAt < now.getTime() + 10 * 60 * 1000);
		assert.ok(firesAt < Date.parse(chargeAt));
	});

	it("never schedules in the past — an already-elapsed 7-day mark still fires ahead of now", () => {
		const now = new Date("2026-07-14T12:00:00.000Z");

		const firesAt = Date.parse(
			chargeReminderFiresAt({ chargeAt: "2026-07-15T00:00:00.000Z", now }),
		);

		assert.ok(firesAt > now.getTime());
		assert.ok(firesAt - now.getTime() <= 5 * 60 * 1000);
	});

	it("keeps the 7-day lead for a full 14-day trial converted on day one", () => {
		const now = new Date("2026-07-01T09:30:00.000Z");
		const chargeAt = new Date(now.getTime() + 14 * DAY_MS).toISOString();

		assert.equal(
			chargeReminderFiresAt({ chargeAt, now }),
			new Date(Date.parse(chargeAt) - 7 * DAY_MS).toISOString(),
		);
	});
});

const HOUR_MS = 3_600_000;
const DIGEST_SCAN_TICK_MS = 6 * HOUR_MS;
const TRIAL_ENDS_AT = "2026-07-19T10:00:00.000Z";
const USER_ID = UserIdSchema.parse("7".repeat(32));

function trialingRow(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
	return {
		userId: USER_ID,
		provider: "stripe",
		status: "trialing",
		trialEndsAt: TRIAL_ENDS_AT,
		createdAt: "2026-07-05T10:00:00.000Z",
		updatedAt: "2026-07-05T10:00:00.000Z",
		...overrides,
	};
}

function beforeTrialEnd(ms: number): Date {
	return new Date(Date.parse(TRIAL_ENDS_AT) - ms);
}

describe("pay digest window", () => {
	it("stays open 36h — six digest-scan ticks, so at least three ticks always land inside it", () => {
		const windowMs = PAY_DIGEST_WINDOW_OPENS_LEAD_MS - PAY_DIGEST_WINDOW_CLOSES_LEAD_MS;

		assert.equal(windowMs, 36 * HOUR_MS);
		assert.equal(windowMs / DIGEST_SCAN_TICK_MS, 6);
		assert.ok(windowMs >= 3 * DIGEST_SCAN_TICK_MS);
	});

	it("closes before the day-12 trial reminder fires, so the pay digest always comes first", () => {
		assert.ok(PAY_DIGEST_WINDOW_CLOSES_LEAD_MS > TRIAL_REMINDER_LEAD_DAYS * 24 * HOUR_MS);
		assert.ok(
			beforeTrialEnd(PAY_DIGEST_WINDOW_CLOSES_LEAD_MS).getTime() <
				Date.parse(trialReminderFiresAt(TRIAL_ENDS_AT)),
		);
	});

	it("closes at least one tick before a checkout stops keeping the trial — 11h55m of margin", () => {
		const marginMs = PAY_DIGEST_WINDOW_CLOSES_LEAD_MS - STRIPE_CHECKOUT_MIN_TRIAL_END_LEAD_MS;

		assert.ok(marginMs >= DIGEST_SCAN_TICK_MS);
		assert.equal(marginMs, 11 * HOUR_MS + 55 * 60_000);
	});
});

describe("isPayDigestDue", () => {
	it("is due from the instant the window opens, 96h before the trial ends", () => {
		assert.equal(
			isPayDigestDue({
				row: trialingRow(),
				messageId: "msg-pay",
				now: beforeTrialEnd(PAY_DIGEST_WINDOW_OPENS_LEAD_MS),
			}),
			true,
		);
		assert.equal(
			isPayDigestDue({
				row: trialingRow(),
				messageId: "msg-pay",
				now: beforeTrialEnd(PAY_DIGEST_WINDOW_OPENS_LEAD_MS + 1),
			}),
			false,
		);
	});

	it("stops being due the instant the window closes, 60h before the trial ends", () => {
		assert.equal(
			isPayDigestDue({
				row: trialingRow(),
				messageId: "msg-pay",
				now: beforeTrialEnd(PAY_DIGEST_WINDOW_CLOSES_LEAD_MS + 1),
			}),
			true,
		);
		assert.equal(
			isPayDigestDue({
				row: trialingRow(),
				messageId: "msg-pay",
				now: beforeTrialEnd(PAY_DIGEST_WINDOW_CLOSES_LEAD_MS),
			}),
			false,
		);
	});

	it("is never due for a reader who is no longer trialing — payers and pending cancellations never see the pay block", () => {
		const now = beforeTrialEnd(72 * HOUR_MS);

		for (const status of ["active", "pending_cancellation", "cancelled"] as const) {
			assert.equal(
				isPayDigestDue({ row: trialingRow({ status }), messageId: "msg-pay", now }),
				false,
				status,
			);
		}
	});

	it("is not due once another message has sent this trial's pay digest", () => {
		assert.equal(
			isPayDigestDue({
				row: trialingRow({
					payDigestEmailSentAt: "2026-07-15T12:00:00.000Z",
					payDigestMessageId: "msg-earlier",
				}),
				messageId: "msg-pay",
				now: beforeTrialEnd(72 * HOUR_MS),
			}),
			false,
		);
	});

	it("stays due for a redelivery of the message that sent it, so the redrive reaches the claim's redelivery branch", () => {
		assert.equal(
			isPayDigestDue({
				row: trialingRow({
					payDigestEmailSentAt: "2026-07-15T12:00:00.000Z",
					payDigestMessageId: "msg-pay",
				}),
				messageId: "msg-pay",
				now: beforeTrialEnd(72 * HOUR_MS),
			}),
			true,
		);
	});
});

describe("trialEndToPreserve", () => {
	it("keeps the trial end when exactly the Stripe lead remains", () => {
		assert.equal(
			trialEndToPreserve({
				row: trialingRow(),
				now: beforeTrialEnd(STRIPE_CHECKOUT_MIN_TRIAL_END_LEAD_MS),
			}),
			TRIAL_ENDS_AT,
		);
	});

	it("drops the trial end 1ms inside the Stripe lead — Stripe would reject a trial_end that close", () => {
		assert.equal(
			trialEndToPreserve({
				row: trialingRow(),
				now: beforeTrialEnd(STRIPE_CHECKOUT_MIN_TRIAL_END_LEAD_MS - 1),
			}),
			undefined,
		);
	});
});

describe("payCutoff", () => {
	it("is 48h05m before the trial ends", () => {
		assert.equal(payCutoff(TRIAL_ENDS_AT), "2026-07-17T09:55:00.000Z");
	});

	it("is the last instant a checkout still keeps the trial, so the email's promise holds whenever it is read", () => {
		const cutoffMs = Date.parse(payCutoff(TRIAL_ENDS_AT));

		assert.equal(trialEndToPreserve({ row: trialingRow(), now: new Date(cutoffMs) }), TRIAL_ENDS_AT);
		assert.equal(trialEndToPreserve({ row: trialingRow(), now: new Date(cutoffMs + 1) }), undefined);
	});
});
