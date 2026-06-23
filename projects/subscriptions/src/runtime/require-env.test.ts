import { requireEnv } from "./require-env";

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
