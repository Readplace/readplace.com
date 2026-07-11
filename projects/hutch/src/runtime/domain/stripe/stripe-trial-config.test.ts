import assert from "node:assert/strict";
import {
	CHARGE_REMINDER_LEAD_DAYS,
	chargeReminderFiresAt,
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
