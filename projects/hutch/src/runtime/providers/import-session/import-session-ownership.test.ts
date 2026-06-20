import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { isAccessibleBy, ownershipCondition } from "./import-session-ownership";

const A = UserIdSchema.parse("00000000000000000000000000000001");
const B = UserIdSchema.parse("00000000000000000000000000000002");

describe("isAccessibleBy", () => {
	it("lets an anonymous caller reach an anonymous session (capability)", () => {
		assert.equal(isAccessibleBy({ ownerId: undefined, callerId: undefined }), true);
	});

	it("lets an authenticated caller adopt an anonymous session", () => {
		assert.equal(isAccessibleBy({ ownerId: undefined, callerId: A }), true);
	});

	it("lets the owner reach their own session", () => {
		assert.equal(isAccessibleBy({ ownerId: A, callerId: A }), true);
	});

	it("denies an anonymous caller on an owned session", () => {
		assert.equal(isAccessibleBy({ ownerId: A, callerId: undefined }), false);
	});

	it("denies a different authenticated caller on an owned session", () => {
		assert.equal(isAccessibleBy({ ownerId: A, callerId: B }), false);
	});
});

describe("ownershipCondition", () => {
	it("guards an anonymous write by attribute_not_exists(userId) alone", () => {
		assert.equal(ownershipCondition(undefined), "attribute_not_exists(userId)");
	});

	it("guards an authenticated write by the owner-or-anon condition", () => {
		assert.equal(ownershipCondition(A), "attribute_not_exists(userId) OR userId = :uid");
	});
});
