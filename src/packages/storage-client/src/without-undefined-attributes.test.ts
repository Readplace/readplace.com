import { withoutUndefinedAttributes } from "./without-undefined-attributes";

describe("withoutUndefinedAttributes", () => {
	it("drops top-level attributes whose value is undefined and keeps null, falsy and nested values", () => {
		expect(
			withoutUndefinedAttributes({ a: 1, b: undefined, c: null, d: 0, e: "", f: { g: undefined } }),
		).toEqual({ a: 1, c: null, d: 0, e: "", f: { g: undefined } });
	});
});
