import { getEnv, requireEnv } from "./require-env";

const KEY = "BLOG_SITE_REQUIRE_ENV_TEST";

afterEach(() => {
	delete process.env[KEY];
});

describe("requireEnv", () => {
	it("returns the value when the variable is set", () => {
		process.env[KEY] = "value";
		expect(requireEnv(KEY)).toBe("value");
	});

	it("throws when the variable is not set", () => {
		expect(() => requireEnv(KEY)).toThrow(/is required but not set/);
	});
});

describe("getEnv", () => {
	it("returns the value when the variable is set", () => {
		process.env[KEY] = "value";
		expect(getEnv(KEY)).toBe("value");
	});

	it("returns undefined when the variable is an empty string", () => {
		process.env[KEY] = "";
		expect(getEnv(KEY)).toBeUndefined();
	});

	it("returns undefined when the variable is not set", () => {
		expect(getEnv(KEY)).toBeUndefined();
	});
});
