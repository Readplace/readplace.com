import assert from "node:assert/strict";
import { ForwardableSenderSchema, GmailAccountEmailSchema, GmailMessageIdSchema, type GmailMessageOrigin } from "@packages/domain/gmail";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryGmailMessageUpdate } from "@packages/test-fixtures/providers/gmail-history-import";
import { initDiscardPendingGmailUpdatesForSender } from "./discard-pending-gmail-updates";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const ACCOUNT = GmailAccountEmailSchema.parse("reader@gmail.com");
const SENDER = ForwardableSenderSchema.parse("dan@news.test");
const OTHER_SENDER = ForwardableSenderSchema.parse("crew@brew.test");
const NOW = new Date("2026-10-27T00:00:00.000Z");

function origin(gmailMessageId: string, senderEmail: typeof SENDER): GmailMessageOrigin {
	return { kind: "history", accountEmail: ACCOUNT, gmailMessageId: GmailMessageIdSchema.parse(gmailMessageId), senderEmail };
}

describe("initDiscardPendingGmailUpdatesForSender", () => {
	it("discards only the sender's pending updates", async () => {
		const updates = initInMemoryGmailMessageUpdate();
		await updates.recordPending({ userId: USER, receivedAtMessageId: "a", origin: origin("m1", SENDER), now: NOW });
		await updates.recordPending({ userId: USER, receivedAtMessageId: "b", origin: origin("m2", OTHER_SENDER), now: NOW });
		const discard = initDiscardPendingGmailUpdatesForSender(updates);

		const discarded = await discard({ userId: USER, accountEmail: ACCOUNT, senderEmail: SENDER });

		const remaining = await updates.listPendingByAccount({ userId: USER, accountEmail: ACCOUNT });
		assert.deepEqual({ discarded, remaining: remaining.map((update) => update.receivedAtMessageId) }, { discarded: 1, remaining: ["b"] });
	});

	it("counts only the updates it actually discarded", async () => {
		const updates = initInMemoryGmailMessageUpdate();
		await updates.recordPending({ userId: USER, receivedAtMessageId: "a", origin: origin("m1", SENDER), now: NOW });
		const discard = initDiscardPendingGmailUpdatesForSender({
			listPendingByAccount: updates.listPendingByAccount,
			discardPending: async () => "unchanged",
		});

		assert.equal(await discard({ userId: USER, accountEmail: ACCOUNT, senderEmail: SENDER }), 0);
	});
});
