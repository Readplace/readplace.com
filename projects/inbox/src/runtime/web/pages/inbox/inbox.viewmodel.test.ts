import {
	AliasNameSchema,
	type InboxAddressEntry,
	InboxAddressSchema,
	InboxTokenSchema,
} from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { toInboxAddressesViewModel } from "./inbox.viewmodel";

function entry(input: {
	name: string;
	address: string;
	disabledAt?: string;
}): InboxAddressEntry {
	return {
		address: InboxAddressSchema.parse(input.address),
		userId: UserIdSchema.parse("user-1"),
		name: AliasNameSchema.parse(input.name),
		token: InboxTokenSchema.parse("3f9a2c"),
		createdAt: "2026-06-23T00:00:00.000Z",
		disabledAt: input.disabledAt,
	};
}

describe("toInboxAddressesViewModel", () => {
	it("partitions interleaved entries into active-first lists, keeping creation order inside each partition", () => {
		const vm = toInboxAddressesViewModel([
			entry({
				name: "gmail",
				address: "gmail-aaa111@read.place",
				disabledAt: "2026-06-20T00:00:00.000Z",
			}),
			entry({ name: "netflix", address: "netflix-bbb222@read.place" }),
			entry({
				name: "substack",
				address: "substack-ccc333@read.place",
				disabledAt: "2026-06-22T00:00:00.000Z",
			}),
		]);

		expect(vm.hasAddresses).toBe(true);
		expect(vm.activeAddresses).toEqual([
			{ name: "netflix", address: "netflix-bbb222@read.place" },
		]);
		expect(vm.disabledAddresses).toEqual([
			{ name: "gmail", address: "gmail-aaa111@read.place" },
			{ name: "substack", address: "substack-ccc333@read.place" },
		]);
		expect(vm.hasDisabled).toBe(true);
		expect(vm.disabledCount).toBe(2);
	});

	it("leaves the disabled partition empty when every address is live", () => {
		const vm = toInboxAddressesViewModel([
			entry({ name: "netflix", address: "netflix-bbb222@read.place" }),
			entry({ name: "gmail", address: "gmail-aaa111@read.place" }),
		]);

		expect(vm.hasAddresses).toBe(true);
		expect(vm.activeAddresses).toEqual([
			{ name: "netflix", address: "netflix-bbb222@read.place" },
			{ name: "gmail", address: "gmail-aaa111@read.place" },
		]);
		expect(vm.disabledAddresses).toEqual([]);
		expect(vm.hasDisabled).toBe(false);
		expect(vm.disabledCount).toBe(0);
	});

	it("reports no addresses for an empty list", () => {
		const vm = toInboxAddressesViewModel([]);

		expect(vm.hasAddresses).toBe(false);
		expect(vm.activeAddresses).toEqual([]);
		expect(vm.disabledAddresses).toEqual([]);
		expect(vm.hasDisabled).toBe(false);
		expect(vm.disabledCount).toBe(0);
	});
});
