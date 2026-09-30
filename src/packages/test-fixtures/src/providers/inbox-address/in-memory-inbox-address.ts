import assert from "node:assert";
import { ConditionalCheckFailedException } from "@packages/hutch-storage-client";
import { DEFAULT_READLIST_SLUG, type ReadlistSlug } from "@packages/domain/readlist";
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
	addressCapReached,
	GMAIL_FORWARDING_ALIAS,
	type InboxAddress,
} from "@packages/domain/inbox";

export function initInMemoryInboxAddress(deps: { now: () => Date }): InboxAddressStore {
	const rows = new Map<string, InboxAddressEntry>();
	const readlistClaims = new Map<string, { userId: UserId; address: InboxAddress }>();
	const claimKey = (input: { userId: UserId; readlist: ReadlistSlug }) => `${input.userId}#${input.readlist}`;

	const listAddressesByUserId = async (userId: UserId) =>
		[...rows.values()].filter((row) => row.userId === userId);

	const store: InboxAddressStore = {
		createAddress: async ({ userId, domain, name, purpose }) => {
			if (addressCapReached({ purpose, owned: await listAddressesByUserId(userId) })) {
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
				readlist: undefined,
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
		setAddressReadlist: async ({ userId, address, readlist }) => {
			const row = rows.get(address);
			if (row === undefined || row.userId !== userId) {
				throw new ConditionalCheckFailedException({
					$metadata: {},
					message: "The conditional request failed",
				});
			}
			rows.set(address, { ...row, readlist });
		},
		clearReadlistFromAddresses: async ({ userId, readlist }) => {
			for (const [address, entry] of rows) {
				if (entry.userId === userId && entry.readlist === readlist) {
					rows.set(address, { ...entry, readlist: undefined });
				}
			}
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
					readlist: undefined,
				});
			}
		},
		getOrCreateReadlistAddress: async ({ userId, domain, readlist }) => {
			const existing = await store.findReadlistAddress({ userId, readlist });
			if (existing !== undefined) return existing;
			const minted = await store.createAddress({ userId, domain, name: GMAIL_FORWARDING_ALIAS, purpose: "gmail-readlist" });
			const routed = { ...minted, readlist: readlist === DEFAULT_READLIST_SLUG ? undefined : readlist };
			rows.set(minted.address, routed);
			const winner = readlistClaims.get(claimKey({ userId, readlist }));
			if (winner !== undefined) {
				await store.disableAddress({ userId, address: minted.address });
				const found = rows.get(winner.address);
				assert(found, "a readlist address claim must point at an address row");
				return found;
			}
			readlistClaims.set(claimKey({ userId, readlist }), { userId, address: minted.address });
			return routed;
		},
		findReadlistAddress: async ({ userId, readlist }) => {
			const claim = readlistClaims.get(claimKey({ userId, readlist }));
			return claim === undefined ? undefined : rows.get(claim.address);
		},
		retireReadlistAddress: async ({ userId, readlist }) => {
			const claim = readlistClaims.get(claimKey({ userId, readlist }));
			if (claim === undefined) return undefined;
			await store.disableAddress({ userId, address: claim.address });
			readlistClaims.delete(claimKey({ userId, readlist }));
			return claim.address;
		},
		deleteReadlistAddressClaims: async (userId) => {
			for (const [key, claim] of readlistClaims) {
				if (claim.userId === userId) readlistClaims.delete(key);
			}
		},
	};
	return store;
}
