import assert from "node:assert/strict";
import {
	isDismissed,
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

	it("reads the closed flag when present and correctly typed", () => {
		assert.deepEqual(parseStoredState(JSON.stringify({ closed: true })), {
			closed: true,
		});
	});

	it("ignores closed when it has the wrong type", () => {
		assert.deepEqual(parseStoredState(JSON.stringify({ closed: "yes" })), {});
	});

	it("ignores unknown fields and keeps the empty shape", () => {
		assert.deepEqual(parseStoredState(JSON.stringify({ other: 1 })), {});
	});
});

describe("serializeState", () => {
	it("round-trips through parseStoredState", () => {
		const state = { closed: true };
		assert.deepEqual(parseStoredState(serializeState(state)), state);
	});
});

describe("isDismissed", () => {
	it("is true once the reader has closed the popup", () => {
		assert.equal(isDismissed({ closed: true }), true);
	});

	it("is false for a fresh device with no stored close", () => {
		assert.equal(isDismissed({}), false);
	});

	it("is false when closed is explicitly false", () => {
		assert.equal(isDismissed({ closed: false }), false);
	});
});
