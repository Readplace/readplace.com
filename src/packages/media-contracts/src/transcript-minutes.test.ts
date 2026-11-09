import assert from "node:assert/strict";
import { allowanceSeconds, billableSeconds, chargedMinutes, displayMinutes } from "./transcript-minutes";

describe("billableSeconds", () => {
	it("bills a file shorter than the 15-second minimum as 15 seconds", () => {
		assert.equal(billableSeconds(14.2), 15);
	});

	it("charges the nearest whole second, so a metadata overshoot of a frame does not cost a second", () => {
		assert.deepEqual([billableSeconds(120.046), billableSeconds(50.077), billableSeconds(61.6)], [120, 50, 62]);
	});
});

describe("allowanceSeconds", () => {
	it("divides the daily budget by the per-second price, rounding down", () => {
		assert.equal(allowanceSeconds({ budgetMilliCents: 50_000, milliCentsPerSecond: 40 }), 1250);
	});
});

describe("displayMinutes", () => {
	it("shows whole minutes, rounding down", () => {
		assert.deepEqual([displayMinutes(1250), displayMinutes(600)], [20, 10]);
	});
});

describe("chargedMinutes", () => {
	it("charges any part of a minute as a whole minute", () => {
		assert.deepEqual([chargedMinutes(50), chargedMinutes(60), chargedMinutes(61)], [1, 1, 2]);
	});
});
