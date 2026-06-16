import { getEnv, requireEnv } from "./require-env";

describe("requireEnv", () => {
	it("should return the value when the environment variable is set", () => {
		process.env.TEST_REQUIRE_ENV = "test-value";
		expect(requireEnv("TEST_REQUIRE_ENV")).toBe("test-value");
		delete process.env.TEST_REQUIRE_ENV;
	});

	it("should throw when the environment variable is not set", () => {
		delete process.env.TEST_REQUIRE_ENV_MISSING;
		expect(() => requireEnv("TEST_REQUIRE_ENV_MISSING")).toThrow(
			"Environment variable TEST_REQUIRE_ENV_MISSING is required but not set",
		);
	});
});

describe("getEnv", () => {
	it("should return the value when the environment variable is set", () => {
		process.env.TEST_GET_ENV = "some-value";
		expect(getEnv("TEST_GET_ENV")).toBe("some-value");
		delete process.env.TEST_GET_ENV;
	});

	it("should return undefined when the environment variable is not set", () => {
		delete process.env.TEST_GET_ENV_MISSING;
		expect(getEnv("TEST_GET_ENV_MISSING")).toBeUndefined();
	});

	it("should return undefined when the environment variable is empty string", () => {
		process.env.TEST_GET_ENV_EMPTY = "";
		expect(getEnv("TEST_GET_ENV_EMPTY")).toBeUndefined();
		delete process.env.TEST_GET_ENV_EMPTY;
	});
});
