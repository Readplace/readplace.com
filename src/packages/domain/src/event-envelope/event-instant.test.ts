import assert from "node:assert/strict";
import { EventEnvelope, EventInstantSchema, floorToSecond, toEventInstant } from "./index";

describe("event instant", () => {
	it("an event time with milliseconds floors to the marker written in that second", () => {
		const fromEvent = EventInstantSchema.parse("2026-05-22T10:00:00.750Z");
		const fromMarker = toEventInstant(new Date("2026-05-22T10:00:00.900Z"));

		assert.equal(fromEvent, fromMarker);
		assert.equal(fromEvent, "2026-05-22T10:00:00Z");
	});

	it("floorToSecond keeps the second and drops the rest", () => {
		assert.equal(floorToSecond(new Date("2026-05-22T10:00:07.999Z")).toISOString(), "2026-05-22T10:00:07.000Z");
	});

	it("EventEnvelope refuses a body whose time is not an ISO instant", () => {
		assert.equal(EventEnvelope.safeParse({ detail: {}, time: "yesterday" }).success, false);
	});

	it("EventEnvelope reads the whole-second time EventBridge writes", () => {
		const envelope = EventEnvelope.parse({ detail: { a: 1 }, time: "2026-11-03T10:00:00Z" });

		assert.equal(envelope.time, "2026-11-03T10:00:00Z");
		assert.deepEqual(envelope.detail, { a: 1 });
	});
});
