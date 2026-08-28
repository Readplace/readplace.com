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

describe("initInMemoryGmailHeldMail", () => {
	it("stores a held message and reads it back for its sender", async () => {
		const store = initInMemoryGmailHeldMail();
		const entry = heldMail();

		assert.equal(await store.holdMail(entry), "stored");

		assert.deepEqual(
			await store.listHeldMailBySender({ userId: owner, senderEmail: tldr, limit: 5 }),
			[entry],
		);
	});

	it("reports a redelivered message as a duplicate", async () => {
		const store = initInMemoryGmailHeldMail();
		const entry = heldMail();
		await store.holdMail(entry);

		assert.equal(await store.holdMail(entry), "duplicate");
		assert.equal(
			(await store.listHeldMailBySender({ userId: owner, senderEmail: tldr, limit: 5 })).length,
			1,
		);
	});

	it("returns the newest messages first, capped at the requested limit", async () => {
		const store = initInMemoryGmailHeldMail();
		await store.holdMail(heldMail({ receivedAt: "2026-08-27T00:00:00.000Z" }));
		await store.holdMail(heldMail({ receivedAt: "2026-08-27T02:00:00.000Z" }));
		await store.holdMail(heldMail({ receivedAt: "2026-08-27T01:00:00.000Z" }));

		const held = await store.listHeldMailBySender({
			userId: owner,
			senderEmail: tldr,
			limit: 2,
		});

		assert.deepEqual(
			held.map((entry) => entry.receivedAt),
			["2026-08-27T02:00:00.000Z", "2026-08-27T01:00:00.000Z"],
		);
	});

	it("scopes held mail to one sender and one reader", async () => {
		const store = initInMemoryGmailHeldMail();
		await store.holdMail(heldMail());
		await store.holdMail(
			heldMail({ senderEmail: brew, receivedAt: "2026-08-27T03:00:00.000Z" }),
		);
		await store.holdMail(heldMail({ userId: otherUser }));

		const held = await store.listHeldMailBySender({
			userId: owner,
			senderEmail: tldr,
			limit: 5,
		});

		assert.deepEqual(
			held.map((entry) => entry.senderEmail),
			[tldr],
		);
	});

	it("deletes every held message a reader owns while leaving other readers alone", async () => {
		const store = initInMemoryGmailHeldMail();
		await store.holdMail(heldMail());
		await store.holdMail(heldMail({ userId: otherUser }));

		await store.deleteAllHeldMailByUserId(owner);

		assert.deepEqual(
			await store.listHeldMailBySender({ userId: owner, senderEmail: tldr, limit: 5 }),
			[],
		);
		assert.equal(
			(await store.listHeldMailBySender({ userId: otherUser, senderEmail: tldr, limit: 5 }))
				.length,
			1,
		);
	});
});
