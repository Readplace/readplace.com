import { UserIdSchema } from "@packages/domain/user";
import { InboxAddressSchema } from "@packages/domain/inbox";
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

	it("disables an owned address by stamping disabledAt", async () => {
		const store = initInMemoryInboxAddress({
			now: () => new Date("2026-06-23T12:00:00.000Z"),
		});
		const entry = await store.createAddress({ userId: owner, domain: DOMAIN });

		await store.disableAddress({ userId: owner, address: entry.address });

		const [refreshed] = await store.listAddressesByUserId(owner);
		expect(refreshed.disabledAt).toBe("2026-06-23T12:00:00.000Z");
	});

	it("ignores a disable for an address that does not exist", async () => {
		const store = initInMemoryInboxAddress({ now: () => new Date() });
		const missing = InboxAddressSchema.parse("in-3f9a2c@read.place");

		await store.disableAddress({ userId: owner, address: missing });

		expect(await store.listAddressesByUserId(owner)).toHaveLength(0);
	});

	it("ignores a disable requested by a non-owner", async () => {
		const store = initInMemoryInboxAddress({ now: () => new Date() });
		const entry = await store.createAddress({ userId: owner, domain: DOMAIN });

		await store.disableAddress({ userId: otherUser, address: entry.address });

		const [refreshed] = await store.listAddressesByUserId(owner);
		expect(refreshed.disabledAt).toBeUndefined();
	});
});
