import assert from "node:assert/strict";
import {
	NEXT_READ_MINIMUM_SAVES,
	hasEnoughSavesForNextRead,
} from "./next-read-minimum";

describe("hasEnoughSavesForNextRead", () => {
	it("refuses a pile one save short of the minimum", () => {
		assert.equal(hasEnoughSavesForNextRead(NEXT_READ_MINIMUM_SAVES - 1), false);
	});

	it("accepts a pile of exactly the minimum", () => {
		assert.equal(hasEnoughSavesForNextRead(NEXT_READ_MINIMUM_SAVES), true);
	});

	it("accepts a pile past the minimum", () => {
		assert.equal(hasEnoughSavesForNextRead(NEXT_READ_MINIMUM_SAVES + 1), true);
	});

	it("refuses an empty pile", () => {
		assert.equal(hasEnoughSavesForNextRead(0), false);
	});
});
