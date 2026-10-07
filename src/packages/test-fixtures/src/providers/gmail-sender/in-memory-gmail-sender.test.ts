import assert from "node:assert/strict";
import { ForwardableSenderSchema } from "@packages/domain/gmail";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryGmailSender } from "./in-memory-gmail-sender";

const owner = UserIdSchema.parse("00000000000000000000000000000001");
const otherUser = UserIdSchema.parse("00000000000000000000000000000002");
const tldr = ForwardableSenderSchema.parse("dan@tldr.tech");
const brew = ForwardableSenderSchema.parse("crew@morningbrew.com");

function store(now: () => Date = () => new Date("2026-08-27T00:00:00.000Z")) {
	return initInMemoryGmailSender({ now });
}

describe("initInMemoryGmailSender", () => {
	it("counts every sighting while keeping the first-seen timestamp", async () => {
		let clock = new Date("2026-08-27T00:00:00.000Z");
		const senders = store(() => clock);
		await senders.recordSenderSeen({ userId: owner, senderEmail: tldr, subject: "first" });

		clock = new Date("2026-08-27T01:00:00.000Z");
		await senders.recordSenderSeen({ userId: owner, senderEmail: tldr, subject: "second" });

		assert.deepEqual(await senders.findSender({ userId: owner, senderEmail: tldr }), {
			userId: owner,
			senderEmail: tldr,
			firstSeenAt: "2026-08-27T00:00:00.000Z",
			lastSeenAt: "2026-08-27T01:00:00.000Z",
			seenCount: 2,
			lastSubject: "second",
		});
	});

	it("returns undefined for a sender the reader has never met", async () => {
		assert.equal(
			await store().findSender({ userId: owner, senderEmail: tldr }),
			undefined,
		);
	});

	it("lists a reader's own senders in address order", async () => {
		const senders = store();
		await senders.recordSenderSeen({ userId: owner, senderEmail: tldr, subject: "TLDR" });
		await senders.recordSenderSeen({ userId: owner, senderEmail: brew, subject: "Brew" });
		await senders.recordSenderSeen({ userId: otherUser, senderEmail: tldr, subject: "TLDR" });

		const listed = await senders.listSendersByUserId(owner);

		assert.deepEqual(
			listed.map((sender) => sender.senderEmail),
			[brew, tldr],
		);
	});

	it("removes one sender without touching the rest", async () => {
		const senders = store();
		await senders.recordSenderSeen({ userId: owner, senderEmail: tldr, subject: "TLDR" });
		await senders.recordSenderSeen({ userId: owner, senderEmail: brew, subject: "Brew" });

		await senders.removeSender({ userId: owner, senderEmail: tldr });

		assert.deepEqual(
			(await senders.listSendersByUserId(owner)).map((sender) => sender.senderEmail),
			[brew],
		);
	});

	it("deletes every sender a reader owns while leaving other readers alone", async () => {
		const senders = store();
		await senders.recordSenderSeen({ userId: owner, senderEmail: tldr, subject: "TLDR" });
		await senders.recordSenderSeen({ userId: otherUser, senderEmail: brew, subject: "Brew" });

		await senders.deleteAllSendersByUserId(owner);

		assert.deepEqual(await senders.listSendersByUserId(owner), []);
		assert.deepEqual(
			(await senders.listSendersByUserId(otherUser)).map((sender) => sender.senderEmail),
			[brew],
		);
	});
});
