import { ConditionalCheckFailedException } from "@packages/hutch-storage-client";
import type { UserId } from "@packages/domain/user";
import {
	aliasNameFromAddress,
	buildInboxAddress,
	DELETED_ACCOUNT_INBOX_OWNER,
	generateInboxToken,
	INBOX_ADDRESS_MAX_PER_USER,
	InboxAddressLimitReachedError,
	type InboxAddressEntry,
	type InboxAddressStore,
	userAliasCapReached,
} from "@packages/domain/inbox";

export function initInMemoryInboxAddress(deps: { now: () => Date }): InboxAddressStore {
	const rows = new Map<string, InboxAddressEntry>();

	const listAddressesByUserId = async (userId: UserId) =>
		[...rows.values()].filter((row) => row.userId === userId);

	return {
		createAddress: async ({ userId, domain, name, purpose }) => {
			if (userAliasCapReached({ purpose, owned: await listAddressesByUserId(userId) })) {
				throw new InboxAddressLimitReachedError(INBOX_ADDRESS_MAX_PER_USER);
			}
			const token = generateInboxToken();
			const address = buildInboxAddress({ name, token, domain });
			const entry: InboxAddressEntry = {
				address,
				userId,
				name,
				token,
				createdAt: deps.now().toISOString(),
				disabledAt: undefined,
				purpose,
			};
			rows.set(address, entry);
			return entry;
		},
		listAddressesByUserId,
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
		enableAddress: async ({ userId, address }) => {
			const row = rows.get(address);
			if (row === undefined || row.userId !== userId) {
				throw new ConditionalCheckFailedException({
					$metadata: {},
					message: "The conditional request failed",
				});
			}
			rows.set(address, { ...row, disabledAt: undefined });
		},
		findByAddress: async (address) => rows.get(address),
		tombstoneUserAddresses: async (userId) => {
			for (const [address, entry] of rows) {
				if (entry.userId !== userId) continue;
				rows.set(address, {
					...entry,
					userId: DELETED_ACCOUNT_INBOX_OWNER,
					// The dynamo path REMOVEs the PII `name` column and reads backfill the
					// label from the address; model that resolved post-strip state here.
					name: aliasNameFromAddress(entry.address),
					disabledAt: entry.disabledAt ?? deps.now().toISOString(),
				});
			}
		},
	};
}
