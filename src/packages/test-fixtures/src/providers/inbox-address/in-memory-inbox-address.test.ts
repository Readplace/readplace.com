import assert from "node:assert/strict";
import { ConditionalCheckFailedException } from "@packages/hutch-storage-client";
import { UserIdSchema } from "@packages/domain/user";
import {
	AliasNameSchema,
	DELETED_ACCOUNT_INBOX_OWNER,
	INBOX_ADDRESS_MAX_PER_USER,
	InboxAddressLimitReachedError,
	InboxAddressSchema,
} from "@packages/domain/inbox";
import { initInMemoryInboxAddress } from "./in-memory-inbox-address";

const owner = UserIdSchema.parse("00000000000000000000000000000001");
const otherUser = UserIdSchema.parse("00000000000000000000000000000002");
const DOMAIN = "read.place";
const NAME = AliasNameSchema.parse("news");

describe("initInMemoryInboxAddress", () => {
	it("creates an enabled address scoped to the owner", async () => {
		const store = initInMemoryInboxAddress({
			now: () => new Date("2026-06-23T00:00:00.000Z"),
		});

		const entry = await store.createAddress({ userId: owner, domain: DOMAIN, name: NAME });

		expect(entry.address).toMatch(/^news-[0-9a-z]{6}@read\.place$/);
		expect(entry.userId).toBe(owner);
		expect(entry.name).toBe(NAME);
		expect(entry.createdAt).toBe("2026-06-23T00:00:00.000Z");
		expect(entry.disabledAt).toBeUndefined();
	});

	it("persists the chosen name and surfaces it through list and find", async () => {
		const store = initInMemoryInboxAddress({ now: () => new Date() });
		const created = await store.createAddress({ userId: owner, domain: DOMAIN, name: NAME });

		const [listed] = await store.listAddressesByUserId(owner);
		const found = await store.findByAddress(created.address);

		expect(listed.name).toBe(NAME);
		assert(found, "expected the created address to resolve");
		expect(found.name).toBe(NAME);
	});

	it("lists only the requesting user's addresses", async () => {
		const store = initInMemoryInboxAddress({ now: () => new Date() });
		await store.createAddress({ userId: owner, domain: DOMAIN, name: NAME });
		await store.createAddress({ userId: owner, domain: DOMAIN, name: NAME });
		await store.createAddress({ userId: otherUser, domain: DOMAIN, name: NAME });

		const ownerAddresses = await store.listAddressesByUserId(owner);
		const otherAddresses = await store.listAddressesByUserId(otherUser);

		expect(ownerAddresses).toHaveLength(2);
		expect(otherAddresses).toHaveLength(1);
	});

	it("throws InboxAddressLimitReachedError once the user holds the per-user cap of live addresses", async () => {
		const store = initInMemoryInboxAddress({ now: () => new Date() });
		for (let i = 0; i < INBOX_ADDRESS_MAX_PER_USER; i++) {
			await store.createAddress({ userId: owner, domain: DOMAIN, name: NAME });
		}

		await expect(store.createAddress({ userId: owner, domain: DOMAIN, name: NAME })).rejects.toThrow(
			InboxAddressLimitReachedError,
		);
		// The cap is per-user: a different user is unaffected.
		await expect(
			store.createAddress({ userId: otherUser, domain: DOMAIN, name: NAME }),
		).resolves.toBeDefined();
	});

	it("frees a slot when a live address is disabled, since only live addresses count toward the cap", async () => {
		const store = initInMemoryInboxAddress({ now: () => new Date() });
		const first = await store.createAddress({ userId: owner, domain: DOMAIN, name: NAME });
		for (let i = 1; i < INBOX_ADDRESS_MAX_PER_USER; i++) {
			await store.createAddress({ userId: owner, domain: DOMAIN, name: NAME });
		}
		await expect(store.createAddress({ userId: owner, domain: DOMAIN, name: NAME })).rejects.toThrow(
			InboxAddressLimitReachedError,
		);

		await store.disableAddress({ userId: owner, address: first.address });

		await expect(store.createAddress({ userId: owner, domain: DOMAIN, name: NAME })).resolves.toBeDefined();
	});

	it("disables an owned address by stamping disabledAt", async () => {
		const store = initInMemoryInboxAddress({
			now: () => new Date("2026-06-23T12:00:00.000Z"),
		});
		const entry = await store.createAddress({ userId: owner, domain: DOMAIN, name: NAME });

		await store.disableAddress({ userId: owner, address: entry.address });

		const [refreshed] = await store.listAddressesByUserId(owner);
		expect(refreshed.disabledAt).toBe("2026-06-23T12:00:00.000Z");
	});

	it("rejects a disable for an address that does not exist", async () => {
		const store = initInMemoryInboxAddress({ now: () => new Date() });
		const missing = InboxAddressSchema.parse("in-3f9a2c@read.place");

		await expect(
			store.disableAddress({ userId: owner, address: missing }),
		).rejects.toThrow(ConditionalCheckFailedException);

		expect(await store.listAddressesByUserId(owner)).toHaveLength(0);
	});

	it("rejects a disable requested by a non-owner", async () => {
		const store = initInMemoryInboxAddress({ now: () => new Date() });
		const entry = await store.createAddress({ userId: owner, domain: DOMAIN, name: NAME });

		await expect(
			store.disableAddress({ userId: otherUser, address: entry.address }),
		).rejects.toThrow(ConditionalCheckFailedException);

		const [refreshed] = await store.listAddressesByUserId(owner);
		expect(refreshed.disabledAt).toBeUndefined();
	});

	it("resolves a created address to its owner via findByAddress", async () => {
		const store = initInMemoryInboxAddress({
			now: () => new Date("2026-06-23T00:00:00.000Z"),
		});
		const created = await store.createAddress({ userId: owner, domain: DOMAIN, name: NAME });

		const found = await store.findByAddress(created.address);

		assert(found, "expected the created address to resolve");
		expect(found.userId).toBe(owner);
		expect(found.disabledAt).toBeUndefined();
	});

	it("returns undefined from findByAddress for an unknown address", async () => {
		const store = initInMemoryInboxAddress({ now: () => new Date() });
		const missing = InboxAddressSchema.parse("in-3f9a2c@read.place");

		expect(await store.findByAddress(missing)).toBeUndefined();
	});

	it("surfaces disabledAt through findByAddress for a disabled address", async () => {
		const store = initInMemoryInboxAddress({
			now: () => new Date("2026-06-23T12:00:00.000Z"),
		});
		const created = await store.createAddress({ userId: owner, domain: DOMAIN, name: NAME });
		await store.disableAddress({ userId: owner, address: created.address });

		const found = await store.findByAddress(created.address);

		assert(found, "expected the disabled address to resolve");
		expect(found.disabledAt).toBe("2026-06-23T12:00:00.000Z");
	});

	it("enables an owned address by clearing disabledAt", async () => {
		const store = initInMemoryInboxAddress({
			now: () => new Date("2026-06-23T12:00:00.000Z"),
		});
		const entry = await store.createAddress({ userId: owner, domain: DOMAIN, name: NAME });
		await store.disableAddress({ userId: owner, address: entry.address });

		await store.enableAddress({ userId: owner, address: entry.address });

		const [refreshed] = await store.listAddressesByUserId(owner);
		expect(refreshed.disabledAt).toBeUndefined();
	});

	it("rejects an enable for an address that does not exist", async () => {
		const store = initInMemoryInboxAddress({ now: () => new Date() });
		const missing = InboxAddressSchema.parse("in-3f9a2c@read.place");

		await expect(
			store.enableAddress({ userId: owner, address: missing }),
		).rejects.toThrow(ConditionalCheckFailedException);

		expect(await store.listAddressesByUserId(owner)).toHaveLength(0);
	});

	it("rejects an enable requested by a non-owner", async () => {
		const store = initInMemoryInboxAddress({ now: () => new Date() });
		const entry = await store.createAddress({ userId: owner, domain: DOMAIN, name: NAME });
		await store.disableAddress({ userId: owner, address: entry.address });

		await expect(
			store.enableAddress({ userId: otherUser, address: entry.address }),
		).rejects.toThrow(ConditionalCheckFailedException);

		const [refreshed] = await store.listAddressesByUserId(owner);
		expect(refreshed.disabledAt).not.toBeUndefined();
	});

	describe("tombstoneUserAddresses", () => {
		it("unlinks the owner's addresses to the reserved owner, keeps every row, and stamps disabledAt only when unset", async () => {
			let clock = new Date("2026-06-01T00:00:00.000Z");
			const store = initInMemoryInboxAddress({ now: () => clock });
			const live = await store.createAddress({ userId: owner, domain: DOMAIN, name: NAME });
			const alreadyDisabled = await store.createAddress({ userId: owner, domain: DOMAIN, name: NAME });
			await store.disableAddress({ userId: owner, address: alreadyDisabled.address });
			const otherOwned = await store.createAddress({ userId: otherUser, domain: DOMAIN, name: NAME });
			clock = new Date("2026-07-01T00:00:00.000Z");

			await store.tombstoneUserAddresses(owner);

			// The owner no longer resolves any address …
			expect(await store.listAddressesByUserId(owner)).toHaveLength(0);
			// … but each hash stays reserved under the sentinel owner, disabled.
			const liveRow = await store.findByAddress(live.address);
			assert(liveRow, "expected the tombstoned live address to survive");
			expect(liveRow.userId).toBe(DELETED_ACCOUNT_INBOX_OWNER);
			expect(liveRow.disabledAt).toBe("2026-07-01T00:00:00.000Z");
			// An address disabled before deletion keeps its original disabledAt.
			const disabledRow = await store.findByAddress(alreadyDisabled.address);
			assert(disabledRow, "expected the tombstoned disabled address to survive");
			expect(disabledRow.userId).toBe(DELETED_ACCOUNT_INBOX_OWNER);
			expect(disabledRow.disabledAt).toBe("2026-06-01T00:00:00.000Z");
			// Another user's address is untouched.
			const [otherRow] = await store.listAddressesByUserId(otherUser);
			expect(otherRow.address).toBe(otherOwned.address);
			expect(otherRow.userId).toBe(otherUser);
			expect(otherRow.disabledAt).toBeUndefined();
		});
	});
});
