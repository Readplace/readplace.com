import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { emailContentResourceId } from "./email-content-id";

const RECEIVED_AT_MESSAGE_ID = "2026-06-24T09:00:00.000Z#<m@x>";

describe("emailContentResourceId", () => {
	it("derives different content keys for two users that share a receivedAtMessageId", () => {
		const alice = UserIdSchema.parse("00000000000000000000000000000001");
		const bob = UserIdSchema.parse("00000000000000000000000000000002");

		const aliceKey = emailContentResourceId({
			userId: alice,
			receivedAtMessageId: RECEIVED_AT_MESSAGE_ID,
		}).toS3ContentKey();
		const bobKey = emailContentResourceId({
			userId: bob,
			receivedAtMessageId: RECEIVED_AT_MESSAGE_ID,
		}).toS3ContentKey();

		// Same sender Message-ID at the same receipt instant must NOT collide across
		// users: each body is partitioned by its owner just like the row is.
		assert.notEqual(aliceKey, bobKey);
		assert.match(aliceKey, /00000000000000000000000000000001/);
	});

	it("is stable for one user and sort key so the read resolves the write's key", () => {
		const user = UserIdSchema.parse("00000000000000000000000000000001");

		const write = emailContentResourceId({
			userId: user,
			receivedAtMessageId: RECEIVED_AT_MESSAGE_ID,
		}).toS3ContentKey();
		const read = emailContentResourceId({
			userId: user,
			receivedAtMessageId: RECEIVED_AT_MESSAGE_ID,
		}).toS3ContentKey();

		assert.equal(write, read);
	});
});
