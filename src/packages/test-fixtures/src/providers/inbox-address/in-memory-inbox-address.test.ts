import assert from "node:assert/strict";
import { ConditionalCheckFailedException } from "@packages/hutch-storage-client";
import { UserIdSchema } from "@packages/domain/user";
import {
	INBOX_ADDRESS_MAX_PER_USER,
	InboxAddressLimitReachedError,
	InboxAddressSchema,
} from "@packages/domain/inbox";
import { initInMemoryInboxAddress } from "./in-memory-inbox-address";

const owner = UserIdSchema.parse("00000000000000000000000000000001");
const otherUser = UserIdSchema.parse("00000000000000000000000000000002");
const DOMAIN = "read.place";

describe("initInMemoryInboxAddress", () => {
	it("creates an enabled address scoped to the owner", async () => {
		const store = initInMemoryInboxAddress({
			now: () => new Date("2026-06-23T00:00:00.000Z"),
		});

		const entry = await store.createAddress({ userId: owner, domain: DOMAIN });

		expect(entry.address).toMatch(/^in-[0-9a-z]{6}@read\.place$/);
		expect(entry.userId).toBe(owner);
		expect(entry.createdAt).toBe("2026-06-23T00:00:00.000Z");
		expect(entry.disabledAt).toBeUndefined();
	});

	it("lists only the requesting user's addresses", async () => {
		const store = initInMemoryInboxAddress({ now: () => new Date() });
		await store.createAddress({ userId: owner, domain: DOMAIN });
		await store.createAddress({ userId: owner, domain: DOMAIN });
		await store.createAddress({ userId: otherUser, domain: DOMAIN });

		const ownerAddresses = await store.listAddressesByUserId(owner);
		const otherAddresses = await store.listAddressesByUserId(otherUser);

		expect(ownerAddresses).toHaveLength(2);
		expect(otherAddresses).toHaveLength(1);
	});

	it("throws InboxAddressLimitReachedError once the user holds the per-user cap of live addresses", async () => {
		const store = initInMemoryInboxAddress({ now: () => new Date() });
		for (let i = 0; i < INBOX_ADDRESS_MAX_PER_USER; i++) {
			await store.createAddress({ userId: owner, domain: DOMAIN });
		}

		await expect(store.createAddress({ userId: owner, domain: DOMAIN })).rejects.toThrow(
			InboxAddressLimitReachedError,
		);
		// The cap is per-user: a different user is unaffected.
		await expect(
			store.createAddress({ userId: otherUser, domain: DOMAIN }),
		).resolves.toBeDefined();
	});

	it("frees a slot when a live address is disabled, since only live addresses count toward the cap", async () => {
		const store = initInMemoryInboxAddress({ now: () => new Date() });
		const first = await store.createAddress({ userId: owner, domain: DOMAIN });
		for (let i = 1; i < INBOX_ADDRESS_MAX_PER_USER; i++) {
			await store.createAddress({ userId: owner, domain: DOMAIN });
		}
		await expect(store.createAddress({ userId: owner, domain: DOMAIN })).rejects.toThrow(
			InboxAddressLimitReachedError,
		);

		await store.disableAddress({ userId: owner, address: first.address });

		await expect(store.createAddress({ userId: owner, domain: DOMAIN })).resolves.toBeDefined();
	});

	it("disables an owned address by stamping disabledAt", async () => {
		const store = initInMemoryInboxAddress({
			now: () => new Date("2026-06-23T12:00:00.000Z"),
		});
		const entry = await store.createAddress({ userId: owner, domain: DOMAIN });

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
		const entry = await store.createAddress({ userId: owner, domain: DOMAIN });

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
		const created = await store.createAddress({ userId: owner, domain: DOMAIN });

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
		const created = await store.createAddress({ userId: owner, domain: DOMAIN });
		await store.disableAddress({ userId: owner, address: created.address });

		const found = await store.findByAddress(created.address);

		assert(found, "expected the disabled address to resolve");
		expect(found.disabledAt).toBe("2026-06-23T12:00:00.000Z");
	});
});
