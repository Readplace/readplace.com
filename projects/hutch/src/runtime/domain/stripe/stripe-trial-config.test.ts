import assert from "node:assert/strict";
import { trialReminderFiresAt } from "./stripe-trial-config";

describe("trialReminderFiresAt", () => {
	it("subtracts exactly two days from trialEndsAt", () => {
		assert.equal(
			trialReminderFiresAt("2026-07-19T10:00:00.000Z"),
			"2026-07-17T10:00:00.000Z",
		);
	});
});
