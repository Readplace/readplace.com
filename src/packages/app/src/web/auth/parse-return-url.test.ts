import { extractReturnUrl, parseReturnUrl } from "./parse-return-url";

describe("parseReturnUrl", () => {
	it("should return /queue when query has no return param", () => {
		expect(parseReturnUrl({})).toBe("/queue");
	});

	it("should return /queue when query is not an object", () => {
		expect(parseReturnUrl(null)).toBe("/queue");
		expect(parseReturnUrl(undefined)).toBe("/queue");
		expect(parseReturnUrl("string")).toBe("/queue");
	});

	it("should return /queue when return param is not a string", () => {
		expect(parseReturnUrl({ return: 123 })).toBe("/queue");
	});

	it("should return /queue when return param is empty", () => {
		expect(parseReturnUrl({ return: "" })).toBe("/queue");
	});

	it("should preserve valid relative URLs", () => {
		expect(parseReturnUrl({ return: "/oauth/authorize?client_id=test" })).toBe("/oauth/authorize?client_id=test");
	});

	it("should reject protocol-relative URLs", () => {
		expect(parseReturnUrl({ return: "//evil.com" })).toBe("/queue");
	});

	it("should reject absolute URLs", () => {
		expect(parseReturnUrl({ return: "https://evil.com" })).toBe("/queue");
	});

	it("should reject URLs without leading slash", () => {
		expect(parseReturnUrl({ return: "evil.com" })).toBe("/queue");
	});
});

describe("extractReturnUrl", () => {
	it("should return undefined when query has no return param", () => {
		expect(extractReturnUrl({})).toBeUndefined();
	});

	it("should return undefined when query is not an object", () => {
		expect(extractReturnUrl(null)).toBeUndefined();
	});

	it("should return undefined when return param is not a string", () => {
		expect(extractReturnUrl({ return: 123 })).toBeUndefined();
	});

	it("should return the URL for valid relative paths", () => {
		expect(extractReturnUrl({ return: "/oauth/authorize" })).toBe("/oauth/authorize");
	});

	it("should return undefined for protocol-relative URLs", () => {
		expect(extractReturnUrl({ return: "//evil.com" })).toBeUndefined();
	});

	it("should return undefined for absolute URLs", () => {
		expect(extractReturnUrl({ return: "https://evil.com" })).toBeUndefined();
	});
});
