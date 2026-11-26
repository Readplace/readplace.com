import assert from "node:assert/strict";
import type { GmailHeldMailEntry } from "@packages/domain/gmail";
import { ForwardableSenderSchema } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryGmailHeldMail } from "./in-memory-gmail-held-mail";

const owner = UserIdSchema.parse("00000000000000000000000000000001");
const otherUser = UserIdSchema.parse("00000000000000000000000000000002");
const tldr = ForwardableSenderSchema.parse("dan@tldr.tech");
const brew = ForwardableSenderSchema.parse("crew@morningbrew.com");
const gateway = InboxAddressSchema.parse("gmail-a7b2c9@read.place");

function heldMail(overrides: Partial<GmailHeldMailEntry> = {}): GmailHeldMailEntry {
	const receivedAt = overrides.receivedAt ?? "2026-08-27T00:00:00.000Z";
	return {
		userId: owner,
		receivedAtMessageId: `${receivedAt}#<a@mail.tldr.tech>`,
		senderEmail: tldr,
		subject: "TLDR 2026-08-27",
		receivedAt,
		rawEmailS3Key: "raw/owner/a.eml",
		recipientAddress: gateway,
		...overrides,
	};
}

async function heldFromSender(input: {
	store: ReturnType<typeof initInMemoryGmailHeldMail>;
	userId: typeof owner;
	senderEmail: typeof tldr;
}): Promise<GmailHeldMailEntry[]> {
	const held = await input.store.listHeldMailByUserId(input.userId);
	return held.filter((entry) => entry.senderEmail === input.senderEmail);
}

describe("initInMemoryGmailHeldMail", () => {
	it("stores a held message and reads it back for its sender", async () => {
		const store = initInMemoryGmailHeldMail();
		const entry = heldMail();

		assert.equal(await store.holdMail(entry), "stored");

		assert.deepEqual(await heldFromSender({ store, userId: owner, senderEmail: tldr }), [
			entry,
		]);
	});

	it("reports a redelivered message as a duplicate", async () => {
		const store = initInMemoryGmailHeldMail();
		const entry = heldMail();
		await store.holdMail(entry);

		assert.equal(await store.holdMail(entry), "duplicate");
		assert.equal((await heldFromSender({ store, userId: owner, senderEmail: tldr })).length, 1);
	});

	it("scopes held mail to one sender and one reader", async () => {
		const store = initInMemoryGmailHeldMail();
		await store.holdMail(heldMail());
		await store.holdMail(
			heldMail({ senderEmail: brew, receivedAt: "2026-08-27T03:00:00.000Z" }),
		);
		await store.holdMail(heldMail({ userId: otherUser }));

		const held = await heldFromSender({ store, userId: owner, senderEmail: tldr });

		assert.deepEqual(
			held.map((entry) => entry.senderEmail),
			[tldr],
		);
	});

	it("lists every held message one reader owns across senders", async () => {
		const store = initInMemoryGmailHeldMail();
		await store.holdMail(heldMail());
		await store.holdMail(
			heldMail({ senderEmail: brew, receivedAt: "2026-08-27T03:00:00.000Z" }),
		);
		await store.holdMail(heldMail({ userId: otherUser }));

		const held = await store.listHeldMailByUserId(owner);

		assert.deepEqual(
			held.map((entry) => entry.senderEmail).sort(),
			[brew, tldr].sort(),
		);
		assert.ok(held.every((entry) => entry.userId === owner));
	});

	it("deletes every held message a reader owns while leaving other readers alone", async () => {
		const store = initInMemoryGmailHeldMail();
		await store.holdMail(heldMail());
		await store.holdMail(heldMail({ userId: otherUser }));

		await store.deleteAllHeldMailByUserId(owner);

		assert.deepEqual(await heldFromSender({ store, userId: owner, senderEmail: tldr }), []);
		assert.equal(
			(await heldFromSender({ store, userId: otherUser, senderEmail: tldr })).length,
			1,
		);
	});
});
