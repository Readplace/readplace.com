import assert from "node:assert/strict";
import { allowanceSeconds, billableSeconds } from "./transcript-minutes";

describe("billableSeconds", () => {
	it("bills a file shorter than the 15-second minimum as 15 seconds", () => {
		assert.equal(billableSeconds(14.2), 15);
	});

	it("rounds a longer file up to the next whole second", () => {
		assert.equal(billableSeconds(61.1), 62);
	});
});

describe("allowanceSeconds", () => {
	it("divides the daily budget by the per-second price, rounding down", () => {
		assert.equal(allowanceSeconds({ budgetMilliCents: 50_000, milliCentsPerSecond: 40 }), 1250);
	});
});
