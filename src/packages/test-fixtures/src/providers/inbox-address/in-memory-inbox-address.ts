import { ConditionalCheckFailedException } from "@packages/hutch-storage-client";
import {
	buildInboxAddress,
	generateInboxToken,
	type InboxAddressEntry,
	type InboxAddressStore,
} from "@packages/domain/inbox";

export function initInMemoryInboxAddress(deps: { now: () => Date }): InboxAddressStore {
	const rows = new Map<string, InboxAddressEntry>();

	return {
		createAddress: async ({ userId, domain }) => {
			const token = generateInboxToken();
			const address = buildInboxAddress({ token, domain });
			const entry: InboxAddressEntry = {
				address,
				userId,
				token,
				createdAt: deps.now().toISOString(),
				disabledAt: undefined,
			};
			rows.set(address, entry);
			return entry;
		},
		listAddressesByUserId: async (userId) =>
			[...rows.values()].filter((row) => row.userId === userId),
		disableAddress: async ({ userId, address }) => {
			const row = rows.get(address);
			if (row === undefined || row.userId !== userId) {
				throw new ConditionalCheckFailedException({
					$metadata: {},
					message: "The conditional request failed",
				});
			}
			rows.set(address, { ...row, disabledAt: deps.now().toISOString() });
		},
	};
}
