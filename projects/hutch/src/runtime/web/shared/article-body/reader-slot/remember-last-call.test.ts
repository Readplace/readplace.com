import assert from "node:assert/strict";
import { rememberLastCall } from "./remember-last-call";

function countingDouble() {
	const calls = { count: 0 };
	const double = rememberLastCall({
		keyOf: (input: { value: number; label: string }) => [input.value, input.label],
		compute: (input: { value: number; label: string }) => {
			calls.count += 1;
			return input.value * 2;
		},
	});
	return { calls, double };
}

describe("rememberLastCall", () => {
	it("computes once when the key repeats", () => {
		const { calls, double } = countingDouble();

		assert.equal(double({ value: 2, label: "a" }), 4);
		assert.equal(double({ value: 2, label: "a" }), 4);

		assert.equal(calls.count, 1);
	});

	it("computes again when any part of the key changes", () => {
		const { calls, double } = countingDouble();

		double({ value: 2, label: "a" });
		double({ value: 2, label: "b" });
		assert.equal(double({ value: 3, label: "b" }), 6);

		assert.equal(calls.count, 3);
	});

	it("remembers only the last call", () => {
		const { calls, double } = countingDouble();

		double({ value: 2, label: "a" });
		double({ value: 3, label: "a" });
		double({ value: 2, label: "a" });

		assert.equal(calls.count, 3);
	});
});
