import assert from "node:assert/strict";
import { errorClassName } from "./error-class-name";

describe("errorClassName", () => {
	it("names the class of a thrown error without its message", () => {
		assert.equal(errorClassName(new TypeError("reader@gmail.com is not allowed")), "TypeError");
		assert.equal(errorClassName(new Error("anything")), "Error");
	});

	it("names the kind of value when something other than an error is thrown", () => {
		assert.equal(errorClassName("reader@gmail.com"), "non-error:string");
		assert.equal(errorClassName({ token: "secret" }), "non-error:object");
		assert.equal(errorClassName(undefined), "non-error:undefined");
	});
});
