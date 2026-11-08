import assert from "node:assert/strict";
import { EventInstantSchema } from "@packages/domain/event-envelope";
import { messagePredatesStatus } from "./message-predates-status";

describe("messagePredatesStatus", () => {
	it("message from the same second as the status change does not predate it", () => {
		const eventTime = EventInstantSchema.parse("2026-11-03T12:34:56.900Z");

		assert.equal(messagePredatesStatus({ statusEnteredAt: "2026-11-03T12:34:56Z", eventTime }), false);
	});

	it("message from an earlier second predates the status change", () => {
		const eventTime = EventInstantSchema.parse("2026-11-03T12:34:55Z");

		assert.equal(messagePredatesStatus({ statusEnteredAt: "2026-11-03T12:34:56Z", eventTime }), true);
	});

	it("row with no statusEnteredAt is never predated", () => {
		const eventTime = EventInstantSchema.parse("2000-01-01T00:00:00Z");

		assert.equal(messagePredatesStatus({ statusEnteredAt: undefined, eventTime }), false);
	});
});
