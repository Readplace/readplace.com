import assert from "node:assert/strict";
import { ObjectSha256Schema, objectKey } from "./object-sha256";

describe("ObjectSha256Schema", () => {
	it("accepts a lowercase 64-character hex digest", () => {
		assert.equal(ObjectSha256Schema.safeParse("0123456789abcdef".repeat(4)).success, true);
	});

	it.each([["A".repeat(64)], ["a".repeat(63)], ["g".repeat(64)]])("refuses %s", (value) => {
		assert.equal(ObjectSha256Schema.safeParse(value).success, false);
	});
});

describe("objectKey", () => {
	it("places the bytes under objects/sha256/<hex>/<generation>", () => {
		const sha256 = ObjectSha256Schema.parse("9".repeat(64));

		assert.equal(objectKey({ sha256, generation: 4 }), `objects/sha256/${"9".repeat(64)}/4`);
	});
});
