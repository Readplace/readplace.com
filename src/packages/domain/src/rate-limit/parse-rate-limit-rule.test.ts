import assert from "node:assert/strict";
import { parseRateLimitRule } from "./parse-rate-limit-rule";

describe("parseRateLimitRule", () => {
	it("parses '<limit>/<windowSeconds>' into a rule", () => {
		assert.deepEqual(parseRateLimitRule("30/3600"), {
			limit: 30,
			windowSeconds: 3600,
		});
	});

	it("rejects a missing window component", () => {
		assert.throws(() => parseRateLimitRule("30"), /must be "<limit>\/<windowSeconds>"/);
	});

	it("rejects a zero limit", () => {
		assert.throws(() => parseRateLimitRule("0/3600"), /positive integers/);
	});

	it("rejects a zero window", () => {
		assert.throws(() => parseRateLimitRule("30/0"), /positive integers/);
	});

	it("rejects non-numeric input", () => {
		assert.throws(() => parseRateLimitRule("lots/sometimes"), /positive integers/);
	});
});
