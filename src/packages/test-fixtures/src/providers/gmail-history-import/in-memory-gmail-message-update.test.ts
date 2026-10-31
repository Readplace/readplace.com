import assert from "node:assert/strict";
import { ForwardableSenderSchema, GmailAccountEmailSchema, GmailMessageIdSchema } from "@packages/domain/gmail";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryGmailMessageUpdate } from "./in-memory-gmail-message-update";

const userId = UserIdSchema.parse("00000000000000000000000000000001");
const accountEmail = GmailAccountEmailSchema.parse("a@gmail.com");
const origin = { kind: "history" as const, accountEmail, gmailMessageId: GmailMessageIdSchema.parse("m1"), senderEmail: ForwardableSenderSchema.parse("dan@news.test") };
const other = { ...origin, gmailMessageId: GmailMessageIdSchema.parse("m2") };
const now = new Date("2026-10-27T00:00:00.000Z");

describe("initInMemoryGmailMessageUpdate", () => {
	it("keeps a completed record completed through a later pending request and failure", async () => {
		const updates = initInMemoryGmailMessageUpdate();
		await updates.recordPending({ userId, receivedAtMessageId: "r", origin, now });
		await updates.markCompleted({ userId, origin, now });
		assert.equal((await updates.recordPending({ userId, receivedAtMessageId: "r", origin, now })).status, "completed");
		assert.equal(await updates.markFailed({ userId, origin, reason: "dead-lettered", now }), "unchanged");
		assert.equal((await updates.find({ userId, origin }))?.status, "completed");
	});

	it("fails a pending record and lists only pending records for the account", async () => {
		const updates = initInMemoryGmailMessageUpdate();
		await updates.recordPending({ userId, receivedAtMessageId: "r", origin, now });
		await updates.recordPending({ userId, receivedAtMessageId: "r2", origin: other, now });
		assert.equal(await updates.markFailed({ userId, origin, reason: "ambiguous-original", now }), "failed");
		assert.equal(await updates.markFailed({ userId, origin, reason: "dead-lettered", now }), "unchanged");
		const failed = await updates.find({ userId, origin });
		assert(failed?.status === "failed");
		assert.equal(failed.failureReason, "ambiguous-original");
		assert.deepEqual((await updates.listPendingByAccount({ userId, accountEmail: GmailAccountEmailSchema.parse("A@gmail.com") })).map((u) => u.receivedAtMessageId), ["r2"]);
		assert.equal(updates.all().length, 2);
	});

	it("discards only a pending record", async () => {
		const updates = initInMemoryGmailMessageUpdate();
		await updates.recordPending({ userId, receivedAtMessageId: "r", origin, now });
		await updates.recordPending({ userId, receivedAtMessageId: "r2", origin: other, now });
		await updates.markCompleted({ userId, origin: other, now });

		assert.equal(await updates.discardPending({ userId, origin }), "discarded");
		assert.equal(await updates.discardPending({ userId, origin }), "unchanged");
		assert.equal(await updates.discardPending({ userId, origin: other }), "unchanged");
		assert.deepEqual(updates.all().map((update) => update.status), ["completed"]);
	});

	it("ignores completion and failure of an unrecorded update", async () => {
		const updates = initInMemoryGmailMessageUpdate();
		await updates.markCompleted({ userId, origin, now });
		assert.equal(await updates.markFailed({ userId, origin, reason: "dead-lettered", now }), "unchanged");
		assert.equal(await updates.find({ userId, origin }), undefined);
	});
});
