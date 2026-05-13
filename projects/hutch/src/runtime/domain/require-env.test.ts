import { requireEnv, getEnv } from "./require-env";

describe("requireEnv", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv };
	});

	afterAll(() => {
		process.env = originalEnv;
	});

	it("should return the value when the environment variable is set", () => {
		process.env.TEST_VAR = "hello";
		expect(requireEnv("TEST_VAR")).toBe("hello");
	});

	it("should return the default value when the environment variable is not set", () => {
		delete process.env.MISSING_VAR;
		expect(requireEnv("MISSING_VAR", { defaultValue: "fallback" })).toBe("fallback");
	});

	it("should throw when the environment variable is not set and no default provided", () => {
		delete process.env.MISSING_VAR;
		expect(() => requireEnv("MISSING_VAR")).toThrow(
			"Environment variable MISSING_VAR is required but not set",
		);
	});

	it("should return empty string when the environment variable is set to empty string", () => {
		process.env.EMPTY_VAR = "";
		expect(requireEnv("EMPTY_VAR")).toBe("");
	});

	it("should return empty string over default when the environment variable is set to empty string", () => {
		process.env.EMPTY_VAR = "";
		expect(requireEnv("EMPTY_VAR", { defaultValue: "fallback" })).toBe("");
	});

});

describe("getEnv", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv };
	});

	afterAll(() => {
		process.env = originalEnv;
	});

	it("should return the value when the environment variable is set", () => {
		process.env.TEST_VAR = "world";
		expect(getEnv("TEST_VAR")).toBe("world");
	});

	it("should return undefined when the environment variable is not set", () => {
		delete process.env.MISSING_VAR;
		expect(getEnv("MISSING_VAR")).toBeUndefined();
	});

	it("should return undefined when the environment variable is empty string", () => {
		process.env.EMPTY_VAR = "";
		expect(getEnv("EMPTY_VAR")).toBeUndefined();
	});
});
