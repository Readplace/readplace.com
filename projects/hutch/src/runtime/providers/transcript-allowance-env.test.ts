import assert from "node:assert/strict";
import { transcriptAllowanceSecondsFromEnv } from "./transcript-allowance-env";

describe("transcriptAllowanceSecondsFromEnv", () => {
	const original = process.env.TRANSCRIPT_ALLOWANCE_SECONDS;
	afterEach(() => {
		process.env.TRANSCRIPT_ALLOWANCE_SECONDS = original;
	});

	it("reads the daily allowance as whole seconds", () => {
		process.env.TRANSCRIPT_ALLOWANCE_SECONDS = "1250";
		assert.equal(transcriptAllowanceSecondsFromEnv(), 1250);
	});

	it("refuses an allowance that is not a positive whole number", () => {
		process.env.TRANSCRIPT_ALLOWANCE_SECONDS = "0";
		assert.throws(() => transcriptAllowanceSecondsFromEnv());
	});
});
