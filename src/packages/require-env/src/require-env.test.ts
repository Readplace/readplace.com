import assert from "node:assert/strict";
import { getEnv, requireEnv } from "./require-env";

describe("requireEnv", () => {
	it("returns the value when the environment variable is set", () => {
		process.env.TEST_REQUIRE_ENV = "test-value";
		assert.equal(requireEnv("TEST_REQUIRE_ENV"), "test-value");
		delete process.env.TEST_REQUIRE_ENV;
	});

	it("throws when the environment variable is not set", () => {
		delete process.env.TEST_REQUIRE_ENV_MISSING;
		assert.throws(
			() => requireEnv("TEST_REQUIRE_ENV_MISSING"),
			/Environment variable TEST_REQUIRE_ENV_MISSING is required but not set/,
		);
	});
});

describe("getEnv", () => {
	it("returns the value when the environment variable is set", () => {
		process.env.TEST_GET_ENV = "present";
		assert.equal(getEnv("TEST_GET_ENV"), "present");
		delete process.env.TEST_GET_ENV;
	});

	it("returns undefined when the environment variable is unset", () => {
		delete process.env.TEST_GET_ENV_MISSING;
		assert.equal(getEnv("TEST_GET_ENV_MISSING"), undefined);
	});

	it("returns undefined when the environment variable is set but empty", () => {
		process.env.TEST_GET_ENV_EMPTY = "";
		assert.equal(getEnv("TEST_GET_ENV_EMPTY"), undefined);
		delete process.env.TEST_GET_ENV_EMPTY;
	});
});
