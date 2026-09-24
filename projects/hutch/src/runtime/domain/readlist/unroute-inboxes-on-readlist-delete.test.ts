import { AliasNameSchema } from "@packages/domain/inbox";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import type { DeleteReadlistDefinition } from "@packages/provider-contracts/article-store";
import { initInMemoryInboxAddress } from "@packages/test-fixtures/providers/inbox-address";
import { initUnrouteInboxesOnReadlistDelete } from "./unroute-inboxes-on-readlist-delete";

const READER = UserIdSchema.parse("reader-1");
const WORK = ReadlistSlugSchema.parse("work");
const NOW = new Date("2026-09-24T00:00:00.000Z");

async function inboxRoutedToWork() {
	const addresses = initInMemoryInboxAddress({ now: () => NOW });
	const inbox = await addresses.createAddress({
		userId: READER,
		domain: "read.place",
		name: AliasNameSchema.parse("news"),
		purpose: "user-alias",
	});
	await addresses.setAddressReadlist({ userId: READER, address: inbox.address, readlist: WORK });
	return addresses;
}

describe("initUnrouteInboxesOnReadlistDelete", () => {
	it("sends the readlist's inboxes back to All before the readlist itself goes", async () => {
		const addresses = await inboxRoutedToWork();
		const routingWhenDeleted: (string | undefined)[] = [];
		const deleted: Parameters<DeleteReadlistDefinition>[0][] = [];
		const deleteReadlist = initUnrouteInboxesOnReadlistDelete({
			clearReadlistFromAddresses: addresses.clearReadlistFromAddresses,
			deleteReadlistDefinition: async (params) => {
				deleted.push(params);
				for (const entry of await addresses.listAddressesByUserId(READER)) {
					routingWhenDeleted.push(entry.readlist);
				}
				return { deleted: true };
			},
		});

		await deleteReadlist({ userId: READER, slug: WORK });

		expect(deleted).toEqual([{ userId: READER, slug: WORK }]);
		expect(routingWhenDeleted).toEqual([undefined]);
	});

	it("answers with exactly what the readlist store answered", async () => {
		const addresses = await inboxRoutedToWork();
		const answer = { deleted: false };
		const deleteReadlist = initUnrouteInboxesOnReadlistDelete({
			clearReadlistFromAddresses: addresses.clearReadlistFromAddresses,
			deleteReadlistDefinition: async () => answer,
		});

		expect(await deleteReadlist({ userId: READER, slug: WORK })).toBe(answer);
	});

	it("keeps the readlist when its inboxes could not be sent back to All", async () => {
		const failure = new Error("inbox addresses unavailable");
		const deleted: Parameters<DeleteReadlistDefinition>[0][] = [];
		const deleteReadlist = initUnrouteInboxesOnReadlistDelete({
			clearReadlistFromAddresses: async () => {
				throw failure;
			},
			deleteReadlistDefinition: async (params) => {
				deleted.push(params);
				return { deleted: true };
			},
		});

		await expect(deleteReadlist({ userId: READER, slug: WORK })).rejects.toBe(failure);
		expect(deleted).toEqual([]);
	});
});
