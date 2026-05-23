import assert from "node:assert/strict";
import { decomposeTimeLeft, formatCounter } from "./index";

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

describe("formatCounter", () => {
	it("renders '1d 10h 5m 33s'", () => {
		assert.equal(
			formatCounter({ days: 1, hours: 10, minutes: 5, seconds: 33 }),
			"1d 10h 5m 33s",
		);
	});

	it("skips leading zero-unit segments", () => {
		assert.equal(
			formatCounter({ days: 0, hours: 0, minutes: 0, seconds: 5 }),
			"5s",
		);
	});

	it("keeps trailing zeros after the first nonzero segment", () => {
		assert.equal(
			formatCounter({ days: 1, hours: 0, minutes: 0, seconds: 0 }),
			"1d 0h 0m 0s",
		);
	});

	it("renders hours onward when days is zero", () => {
		assert.equal(
			formatCounter({ days: 0, hours: 2, minutes: 0, seconds: 15 }),
			"2h 0m 15s",
		);
	});

	it("renders minutes onward when days and hours are zero", () => {
		assert.equal(
			formatCounter({ days: 0, hours: 0, minutes: 3, seconds: 0 }),
			"3m 0s",
		);
	});
});
