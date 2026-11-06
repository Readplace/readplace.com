import assert from "node:assert/strict";
import { readEnv } from "./read-env";

describe("readEnv", () => {
	it("returns every named value keyed by its name", () => {
		process.env.TEST_READ_ENV_A = "a";
		process.env.TEST_READ_ENV_B = "b";
		assert.deepEqual(readEnv(["TEST_READ_ENV_A", "TEST_READ_ENV_B"] as const), {
			TEST_READ_ENV_A: "a",
			TEST_READ_ENV_B: "b",
		});
		delete process.env.TEST_READ_ENV_A;
		delete process.env.TEST_READ_ENV_B;
	});

	it("throws naming the first name that is not set", () => {
		process.env.TEST_READ_ENV_PRESENT = "present";
		delete process.env.TEST_READ_ENV_MISSING;
		assert.throws(
			() => readEnv(["TEST_READ_ENV_PRESENT", "TEST_READ_ENV_MISSING"] as const),
			/Environment variable TEST_READ_ENV_MISSING is required but not set/,
		);
		delete process.env.TEST_READ_ENV_PRESENT;
	});

	it("returns an empty object when no names are listed", () => {
		assert.deepEqual(readEnv([] as const), {});
	});
});
