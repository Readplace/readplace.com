import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { shareUserIdPrefix } from "./share-user-id-prefix";

describe("shareUserIdPrefix", () => {
	it("returns the first 6 characters of a 32-char hex user id", () => {
		const userId = UserIdSchema.parse("abcdef0123456789abcdef0123456789");
		assert.equal(shareUserIdPrefix(userId), "abcdef");
	});

	it("returns the whole string when the user id is shorter than 6 characters", () => {
		const userId = UserIdSchema.parse("ab12");
		assert.equal(shareUserIdPrefix(userId), "ab12");
	});
});
