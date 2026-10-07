import assert from "node:assert/strict";
import { ForwardableSenderSchema, GmailAccountEmailSchema } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryGmailMapping } from "./in-memory-gmail-mapping";

const owner = UserIdSchema.parse("00000000000000000000000000000001");
const otherUser = UserIdSchema.parse("00000000000000000000000000000002");
const personal = GmailAccountEmailSchema.parse("reader@gmail.com");
const work = GmailAccountEmailSchema.parse("reader@work.example");
const tldr = ForwardableSenderSchema.parse("dan@tldr.tech");
const brew = ForwardableSenderSchema.parse("crew@morningbrew.com");
const tech = InboxAddressSchema.parse("tech-a7b2c9@read.place");
const travel = InboxAddressSchema.parse("travel-a7b2c9@read.place");

function store(now: () => Date = () => new Date("2026-08-27T00:00:00.000Z")) {
	return initInMemoryGmailMapping({ now });
}

describe("initInMemoryGmailMapping", () => {
	it("keeps the original filter timestamp when a sender is re-added", async () => {
		let clock = new Date("2026-08-27T00:00:00.000Z");
		const mappings = store(() => clock);
		await mappings.addSenderToFilter({ userId: owner, accountEmail: personal, senderEmail: tldr });

		clock = new Date("2026-08-27T01:00:00.000Z");
		await mappings.addSenderToFilter({ userId: owner, accountEmail: personal, senderEmail: tldr });

		assert.deepEqual(await mappings.findMapping({ userId: owner, accountEmail: personal, senderEmail: tldr }), {
			accountEmail: personal,
			senderEmail: tldr,
			addedToFilterAt: "2026-08-27T00:00:00.000Z",
			mappedAddresses: undefined,
			mappedAt: undefined,
			deliveryMode: undefined,
		});
	});

	it("replaces a sender's destinations while keeping when it entered the filter", async () => {
		let clock = new Date("2026-08-27T00:00:00.000Z");
		const mappings = store(() => clock);
		await mappings.addSenderToFilter({ userId: owner, accountEmail: personal, senderEmail: tldr });
		await mappings.mapSenderToAddress({ userId: owner, accountEmail: personal, senderEmail: tldr, mappedAddresses: [tech, travel], deliveryMode: "issue" });

		clock = new Date("2026-08-28T00:00:00.000Z");
		await mappings.mapSenderToAddress({ userId: owner, accountEmail: personal, senderEmail: tldr, mappedAddresses: [travel], deliveryMode: "links" });

		assert.deepEqual(await mappings.findMapping({ userId: owner, accountEmail: personal, senderEmail: tldr }), {
			accountEmail: personal,
			senderEmail: tldr,
			addedToFilterAt: "2026-08-27T00:00:00.000Z",
			mappedAddresses: [travel],
			mappedAt: "2026-08-28T00:00:00.000Z",
			deliveryMode: "links",
		});
	});

	it("returns undefined for a sender the Gmail account has no mapping for", async () => {
		const mappings = store();
		await mappings.addSenderToFilter({ userId: owner, accountEmail: work, senderEmail: tldr });

		assert.equal(await mappings.findMapping({ userId: owner, accountEmail: personal, senderEmail: tldr }), undefined);
	});

	it("lists only the requested Gmail account's mappings in sender order", async () => {
		const mappings = store();
		await mappings.addSenderToFilter({ userId: owner, accountEmail: personal, senderEmail: tldr });
		await mappings.addSenderToFilter({ userId: owner, accountEmail: personal, senderEmail: brew });
		await mappings.addSenderToFilter({ userId: owner, accountEmail: work, senderEmail: tldr });
		await mappings.addSenderToFilter({ userId: otherUser, accountEmail: personal, senderEmail: tldr });

		assert.deepEqual(
			(await mappings.listMappings({ userId: owner, accountEmail: personal })).map((mapping) => mapping.senderEmail),
			[brew, tldr],
		);
	});

	it("lists the mappings of every Gmail account a reader connected", async () => {
		const mappings = store();
		await mappings.addSenderToFilter({ userId: owner, accountEmail: work, senderEmail: tldr });
		await mappings.addSenderToFilter({ userId: owner, accountEmail: personal, senderEmail: brew });
		await mappings.addSenderToFilter({ userId: otherUser, accountEmail: personal, senderEmail: tldr });

		assert.deepEqual(
			(await mappings.listMappingsByUserId(owner)).map((mapping) => [mapping.accountEmail, mapping.senderEmail]),
			[[personal, brew], [work, tldr]],
		);
	});

	it("removes one mapping without touching the same sender under another Gmail account", async () => {
		const mappings = store();
		await mappings.addSenderToFilter({ userId: owner, accountEmail: personal, senderEmail: tldr });
		await mappings.addSenderToFilter({ userId: owner, accountEmail: work, senderEmail: tldr });

		await mappings.removeMapping({ userId: owner, accountEmail: personal, senderEmail: tldr });

		assert.deepEqual(
			(await mappings.listMappingsByUserId(owner)).map((mapping) => [mapping.accountEmail, mapping.senderEmail]),
			[[work, tldr]],
		);
	});

	it("deletes every Gmail account's mappings for a reader while leaving other readers alone", async () => {
		const mappings = store();
		await mappings.addSenderToFilter({ userId: owner, accountEmail: personal, senderEmail: tldr });
		await mappings.addSenderToFilter({ userId: owner, accountEmail: work, senderEmail: brew });
		await mappings.addSenderToFilter({ userId: otherUser, accountEmail: personal, senderEmail: tldr });

		await mappings.deleteAllByUserId(owner);

		assert.deepEqual(await mappings.listMappingsByUserId(owner), []);
		assert.deepEqual(
			(await mappings.listMappingsByUserId(otherUser)).map((mapping) => mapping.senderEmail),
			[tldr],
		);
	});
});
