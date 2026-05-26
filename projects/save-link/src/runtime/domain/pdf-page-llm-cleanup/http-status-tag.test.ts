import { httpStatusTag } from "./http-status-tag";

describe("httpStatusTag", () => {
	it("returns ' status=429' for an OpenAI-shape rate-limit error", () => {
		const error = Object.assign(new Error("Too Many Requests"), { status: 429 });
		expect(httpStatusTag(error)).toBe(" status=429");
	});

	it("returns ' status=503' for a generic upstream-failure status", () => {
		expect(httpStatusTag({ status: 503 })).toBe(" status=503");
	});

	it("returns the empty string for a plain Error with no status field", () => {
		expect(httpStatusTag(new Error("network exploded"))).toBe("");
	});

	it("returns the empty string for a thrown non-Error value (e.g. a raw string)", () => {
		expect(httpStatusTag("oops")).toBe("");
	});

	it("returns the empty string when the status field is non-numeric", () => {
		expect(httpStatusTag({ status: "429" })).toBe("");
	});

	it("returns the empty string for null", () => {
		expect(httpStatusTag(null)).toBe("");
	});

	it("returns the empty string for undefined", () => {
		expect(httpStatusTag(undefined)).toBe("");
	});
});
