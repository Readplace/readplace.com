import assert from "node:assert/strict";
import { ForwardableSenderSchema } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryGmailSender } from "./in-memory-gmail-sender";

const owner = UserIdSchema.parse("00000000000000000000000000000001");
const otherUser = UserIdSchema.parse("00000000000000000000000000000002");
const tldr = ForwardableSenderSchema.parse("dan@tldr.tech");
const brew = ForwardableSenderSchema.parse("crew@morningbrew.com");
const alias = InboxAddressSchema.parse("tldr-a7b2c9@read.place");

function store(now: () => Date = () => new Date("2026-08-27T00:00:00.000Z")) {
	return initInMemoryGmailSender({ now });
}

describe("initInMemoryGmailSender", () => {
	it("keeps the original filter timestamp when a sender is re-added", async () => {
		let clock = new Date("2026-08-27T00:00:00.000Z");
		const senders = store(() => clock);
		await senders.addSenderToFilter({ userId: owner, senderEmail: tldr });

		clock = new Date("2026-08-27T01:00:00.000Z");
		await senders.addSenderToFilter({ userId: owner, senderEmail: tldr });

		const sender = await senders.findSender({ userId: owner, senderEmail: tldr });
		assert.equal(sender?.addedToFilterAt, "2026-08-27T00:00:00.000Z");
	});

	it("counts every sighting while keeping the first-seen timestamp", async () => {
		let clock = new Date("2026-08-27T00:00:00.000Z");
		const senders = store(() => clock);
		await senders.recordSenderSeen({ userId: owner, senderEmail: tldr, subject: "first" });

		clock = new Date("2026-08-27T01:00:00.000Z");
		await senders.recordSenderSeen({ userId: owner, senderEmail: tldr, subject: "second" });

		const sender = await senders.findSender({ userId: owner, senderEmail: tldr });
		assert.equal(sender?.seenCount, 2);
		assert.equal(sender?.firstSeenAt, "2026-08-27T00:00:00.000Z");
		assert.equal(sender?.lastSeenAt, "2026-08-27T01:00:00.000Z");
		assert.equal(sender?.lastSubject, "second");
	});

	it("maps a sender onto the alias its mail should land in", async () => {
		const senders = store();
		await senders.addSenderToFilter({ userId: owner, senderEmail: tldr });

		await senders.mapSenderToAddress({
			userId: owner,
			senderEmail: tldr,
			mappedAddress: alias,
		});

		const sender = await senders.findSender({ userId: owner, senderEmail: tldr });
		assert.equal(sender?.mappedAddress, alias);
		assert.equal(sender?.mappedAt, "2026-08-27T00:00:00.000Z");
		assert.equal(sender?.addedToFilterAt, "2026-08-27T00:00:00.000Z");
	});

	it("creates the row when a sender is first mapped without ever being filtered", async () => {
		const senders = store();

		await senders.mapSenderToAddress({
			userId: owner,
			senderEmail: tldr,
			mappedAddress: alias,
		});

		const sender = await senders.findSender({ userId: owner, senderEmail: tldr });
		assert.equal(sender?.addedToFilterAt, undefined);
		assert.equal(sender?.mappedAddress, alias);
	});

	it("returns undefined for a sender the reader has never met", async () => {
		assert.equal(
			await store().findSender({ userId: owner, senderEmail: tldr }),
			undefined,
		);
	});

	it("lists a reader's own senders in address order", async () => {
		const senders = store();
		await senders.addSenderToFilter({ userId: owner, senderEmail: tldr });
		await senders.addSenderToFilter({ userId: owner, senderEmail: brew });
		await senders.addSenderToFilter({ userId: otherUser, senderEmail: tldr });

		const listed = await senders.listSendersByUserId(owner);

		assert.deepEqual(
			listed.map((sender) => sender.senderEmail),
			[brew, tldr],
		);
	});

	it("removes one sender without touching the rest", async () => {
		const senders = store();
		await senders.addSenderToFilter({ userId: owner, senderEmail: tldr });
		await senders.addSenderToFilter({ userId: owner, senderEmail: brew });

		await senders.removeSender({ userId: owner, senderEmail: tldr });

		assert.deepEqual(
			(await senders.listSendersByUserId(owner)).map((sender) => sender.senderEmail),
			[brew],
		);
	});

	it("deletes every sender a reader owns while leaving other readers alone", async () => {
		const senders = store();
		await senders.addSenderToFilter({ userId: owner, senderEmail: tldr });
		await senders.addSenderToFilter({ userId: otherUser, senderEmail: brew });

		await senders.deleteAllSendersByUserId(owner);

		assert.deepEqual(await senders.listSendersByUserId(owner), []);
		assert.deepEqual(
			(await senders.listSendersByUserId(otherUser)).map((sender) => sender.senderEmail),
			[brew],
		);
	});
});
