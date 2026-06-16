import assert from "node:assert/strict";
import {
	ONE_DAY_MS,
	decideVisibility,
	formatCountdown,
	parseStoredState,
	serializeState,
} from "./offer-popup.logic";

describe("parseStoredState", () => {
	it("returns an empty state when nothing is stored", () => {
		assert.deepEqual(parseStoredState(null), {});
	});

	it("returns an empty state for malformed JSON", () => {
		assert.deepEqual(parseStoredState("{not json"), {});
	});

	it("returns an empty state when the stored value is JSON null", () => {
		assert.deepEqual(parseStoredState("null"), {});
	});

	it("returns an empty state when the stored value is not an object", () => {
		assert.deepEqual(parseStoredState("42"), {});
	});

	it("reads all known fields when present and correctly typed", () => {
		const raw = JSON.stringify({ firstVisitAt: 1000, shownAt: 2000, closed: true });
		assert.deepEqual(parseStoredState(raw), {
			firstVisitAt: 1000,
			shownAt: 2000,
			closed: true,
		});
	});

	it("ignores fields with the wrong type", () => {
		const raw = JSON.stringify({ firstVisitAt: "soon", shownAt: null, closed: "yes" });
		assert.deepEqual(parseStoredState(raw), {});
	});

	it("ignores unknown fields and keeps the empty shape", () => {
		assert.deepEqual(parseStoredState(JSON.stringify({ other: 1 })), {});
	});
});

describe("serializeState", () => {
	it("round-trips through parseStoredState", () => {
		const state = { firstVisitAt: 5, shownAt: 9, closed: false };
		assert.deepEqual(parseStoredState(serializeState(state)), state);
	});
});

describe("decideVisibility", () => {
	it("never shows on the first visit and records firstVisitAt", () => {
		const result = decideVisibility({ state: {}, now: 1000 });
		assert.equal(result.show, false);
		assert.deepEqual(result.next, { firstVisitAt: 1000 });
	});

	it("does not show when the second visit is less than a day after the first", () => {
		const firstVisitAt = 1000;
		const result = decideVisibility({
			state: { firstVisitAt },
			now: firstVisitAt + ONE_DAY_MS - 1,
		});
		assert.equal(result.show, false);
		assert.deepEqual(result.next, { firstVisitAt });
	});

	it("shows once on a visit at least a day after the first and records shownAt", () => {
		const firstVisitAt = 1000;
		const now = firstVisitAt + ONE_DAY_MS;
		const result = decideVisibility({ state: { firstVisitAt }, now });
		assert.equal(result.show, true);
		assert.deepEqual(result.next, { firstVisitAt, shownAt: now });
	});

	it("never shows again once it has already been shown", () => {
		const state = { firstVisitAt: 1000, shownAt: 2000 };
		const result = decideVisibility({ state, now: 1000 + 5 * ONE_DAY_MS });
		assert.equal(result.show, false);
		assert.deepEqual(result.next, state);
	});

	it("never shows again once the reader has closed it", () => {
		const state = { firstVisitAt: 1000, closed: true };
		const result = decideVisibility({ state, now: 1000 + 5 * ONE_DAY_MS });
		assert.equal(result.show, false);
		assert.deepEqual(result.next, state);
	});
});

describe("formatCountdown", () => {
	it("formats a multi-minute remaining time as mm:ss", () => {
		assert.equal(formatCountdown(10 * 60 * 1000), "10:00");
	});

	it("zero-pads single-digit minutes and seconds", () => {
		assert.equal(formatCountdown(9 * 60 * 1000 + 5 * 1000), "09:05");
	});

	it("clamps negative remaining time to zero", () => {
		assert.equal(formatCountdown(-5000), "00:00");
	});
});
