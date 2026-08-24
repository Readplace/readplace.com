import assert from "node:assert/strict";
import { decomposeTimeLeft } from "./time-left";

describe("decomposeTimeLeft", () => {
	it("splits 1d 10h 5m 33s into components", () => {
		const ms =
			1 * 24 * 60 * 60 * 1000 +
			10 * 60 * 60 * 1000 +
			5 * 60 * 1000 +
			33 * 1000;
		assert.deepStrictEqual(decomposeTimeLeft(ms), {
			days: 1,
			hours: 10,
			minutes: 5,
			seconds: 33,
		});
	});

	it("returns all zeros for zero input", () => {
		assert.deepStrictEqual(decomposeTimeLeft(0), {
			days: 0,
			hours: 0,
			minutes: 0,
			seconds: 0,
		});
	});

	it("clamps negative input to zero", () => {
		assert.deepStrictEqual(decomposeTimeLeft(-1000), {
			days: 0,
			hours: 0,
			minutes: 0,
			seconds: 0,
		});
	});
});
