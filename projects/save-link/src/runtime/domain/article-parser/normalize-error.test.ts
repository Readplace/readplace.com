import assert from "node:assert/strict";
import { normalizeUnknownError } from "./normalize-error";

describe("normalizeUnknownError", () => {
	it("returns the same Error instance when passed an Error", () => {
		const original = new Error("boom");
		assert.equal(normalizeUnknownError(original), original);
	});

	it("wraps a string in a fresh Error whose message equals the string", () => {
		const result = normalizeUnknownError("opaque thrown");
		assert(result instanceof Error);
		assert.equal(result.message, "opaque thrown");
	});

	it("stringifies a non-Error, non-string value into the Error message", () => {
		const result = normalizeUnknownError({ status: 500 });
		assert(result instanceof Error);
		assert.equal(result.message, "[object Object]");
	});
});
