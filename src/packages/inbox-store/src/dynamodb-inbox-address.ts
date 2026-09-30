import assert from "node:assert";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { DEFAULT_READLIST_SLUG, type ReadlistSlug, ReadlistSlugSchema } from "@packages/domain/readlist";
import { type UserId, UserIdSchema } from "@packages/domain/user";
import {
	aliasNameFromAddress,
	AliasNameSchema,
	buildInboxAddress,
	DEFAULT_INBOX_ADDRESS_PURPOSE,
	DELETED_ACCOUNT_INBOX_OWNER,
	GMAIL_FORWARDING_ALIAS,
	generateInboxToken,
	INBOX_ADDRESS_MAX_CREATE_ATTEMPTS,
	INBOX_ADDRESS_MAX_PER_USER,
	InboxAddressLimitReachedError,
	type AliasName,
	type InboxAddress,
	type InboxAddressEntry,
	type InboxAddressPurpose,
	InboxAddressPurposeSchema,
	InboxAddressSchema,
	type InboxAddressStore,
	InboxTokenSchema,
	type TombstoneUserAddresses,
	addressCapReached,
} from "@packages/domain/inbox";

const InboxAddressRow = z.object({
	address: InboxAddressSchema,
	userId: UserIdSchema,
	// Optional for read-compat with legacy `in-<token>` rows written before the
	// column existed; always written on new creates. `toEntry` backfills a label
	// from the address when it is absent.
	name: dynamoField(AliasNameSchema),
	token: InboxTokenSchema,
	createdAt: z.string(),
	disabledAt: dynamoField(z.string()),
	purpose: dynamoField(InboxAddressPurposeSchema),
	readlist: dynamoField(ReadlistSlugSchema),
});

const ReadlistAddressClaimRow = z.object({
	address: z.string().startsWith("claim#"),
	claimOwner: UserIdSchema,
	claimedAddress: InboxAddressSchema,
	createdAt: z.string(),
});

function readlistClaimKey(input: { userId: UserId; readlist: ReadlistSlug }): { address: string } {
	return { address: `claim#gmail-readlist#${input.userId}#${input.readlist}` };
}

/** The one seam that turns a stored row into a fully-populated entry. */
function toEntry(row: z.infer<typeof InboxAddressRow>): InboxAddressEntry {
	return {
		address: row.address,
		userId: row.userId,
		name: row.name ?? aliasNameFromAddress(row.address),
		token: row.token,
		createdAt: row.createdAt,
		disabledAt: row.disabledAt,
		purpose: row.purpose ?? DEFAULT_INBOX_ADDRESS_PURPOSE,
		readlist: row.readlist,
	};
}

export function initDynamoDbInboxAddress(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	now: () => Date;
}): InboxAddressStore {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: InboxAddressRow,
	});
	const claims = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: ReadlistAddressClaimRow,
	});

	const listAddressesByUserId: InboxAddressStore["listAddressesByUserId"] = async (userId) => {
		// The userId-index GSI is replicated asynchronously and DynamoDB offers no
		// ConsistentRead for secondary indexes, so this read is unavoidably eventually
		// consistent: an address written moments earlier can be absent, which lets the
		// create → redirect → list flow briefly render the empty state right after a
		// successful create. The design absorbs the lag rather than fighting it — the
		// never-delete + conditional-put invariants bound the worst case to a redundant
		// address the user owns (a second valid row), never a lost or cross-user-leaked
		// one, and a reload reconciles once replication catches up.
		const { items } = await table.query({
			IndexName: "userId-index",
			KeyConditionExpression: "userId = :uid",
			ExpressionAttributeValues: { ":uid": userId },
		});
		return items.map(toEntry);
	};

	const tombstoneUserAddresses: TombstoneUserAddresses = async (userId) => {
		const addresses = await listAddressesByUserId(userId);
		await Promise.all(
			addresses.map((entry) =>
				table.update({
					Key: { address: entry.address },
					UpdateExpression:
						"SET userId = :tomb, disabledAt = if_not_exists(disabledAt, :now) REMOVE #name, readlist",
					ConditionExpression: "userId = :uid",
					ExpressionAttributeNames: { "#name": "name" },
					ExpressionAttributeValues: {
						":tomb": DELETED_ACCOUNT_INBOX_OWNER,
						":uid": userId,
						":now": deps.now().toISOString(),
					},
				}),
			),
		);
	};

	const mintAddress = async (input: {
		userId: UserId;
		domain: string;
		name: AliasName;
		purpose: InboxAddressPurpose;
		readlist: ReadlistSlug | undefined;
	}): Promise<InboxAddressEntry> => {
		const { userId, domain, name, purpose, readlist } = input;
		const createdAt = deps.now().toISOString();
		for (let attempt = 0; attempt < INBOX_ADDRESS_MAX_CREATE_ATTEMPTS; attempt++) {
			const token = generateInboxToken();
			const address = buildInboxAddress({ name, token, domain });
			try {
				await table.put({
					Item: {
						address,
						userId,
						name,
						token,
						createdAt,
						purpose,
						...(readlist === undefined ? {} : { readlist }),
					},
					ConditionExpression: "attribute_not_exists(address)",
				});
				return { address, userId, name, token, createdAt, disabledAt: undefined, purpose, readlist };
			} catch (error) {
				if (error instanceof ConditionalCheckFailedException) continue;
				throw error;
			}
		}
		throw new Error(
			`Failed to mint a unique inbox address after ${INBOX_ADDRESS_MAX_CREATE_ATTEMPTS} attempts`,
		);
	};

	const findByAddress: InboxAddressStore["findByAddress"] = async (address) => {
		const row = await table.get({ address }, { consistentRead: true });
		return row === undefined ? undefined : toEntry(row);
	};

	const disableAddress: InboxAddressStore["disableAddress"] = async ({ userId, address }) => {
		await table.update({
			Key: { address },
			ConditionExpression: "userId = :uid",
			UpdateExpression: "SET disabledAt = :now",
			ExpressionAttributeValues: { ":uid": userId, ":now": deps.now().toISOString() },
		});
	};

	const findClaimedAddress = async (input: {
		userId: UserId;
		readlist: ReadlistSlug;
	}): Promise<InboxAddress | undefined> => {
		const claim = await claims.get(readlistClaimKey(input), { consistentRead: true });
		return claim?.claimedAddress;
	};

	const findReadlistAddress: InboxAddressStore["findReadlistAddress"] = async (input) => {
		const claimedAddress = await findClaimedAddress(input);
		if (claimedAddress === undefined) return undefined;
		const entry = await findByAddress(claimedAddress);
		assert(entry, "a readlist address claim must point at an address row");
		return entry;
	};

	const releaseClaim = async (input: {
		userId: UserId;
		readlist: ReadlistSlug;
		claimedAddress: InboxAddress;
	}): Promise<void> => {
		try {
			await claims.delete({
				Key: readlistClaimKey(input),
				ConditionExpression: "claimedAddress = :claimed",
				ExpressionAttributeValues: { ":claimed": input.claimedAddress },
			});
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) return;
			throw error;
		}
	};

	return {
		createAddress: async ({ userId, domain, name, purpose }) => {
			// disabledAt is not a key
			// attribute, so the cap is counted in code over the GSI rows rather than
			// pushed into a COUNT query. The GSI is eventually consistent, so this is a
			// soft guardrail (a racing pair of creates may briefly land one over the
			// cap) — fine, since the cap exists to stop an unbounded create loop, not
			// to enforce an exact-to-the-row ceiling.
			if (addressCapReached({ purpose, owned: await listAddressesByUserId(userId) })) {
				throw new InboxAddressLimitReachedError(INBOX_ADDRESS_MAX_PER_USER);
			}
			return mintAddress({ userId, domain, name, purpose, readlist: undefined });
		},
		listAddressesByUserId,
		disableAddress,
		enableAddress: async ({ userId, address }) => {
			await table.update({
				Key: { address },
				ConditionExpression: "userId = :uid",
				UpdateExpression: "REMOVE disabledAt",
				ExpressionAttributeValues: { ":uid": userId },
			});
		},
		setAddressReadlist: async ({ userId, address, readlist }) => {
			await table.update(
				readlist === undefined
					? {
							Key: { address },
							ConditionExpression: "userId = :uid",
							UpdateExpression: "REMOVE readlist",
							ExpressionAttributeValues: { ":uid": userId },
						}
					: {
							Key: { address },
							ConditionExpression: "userId = :uid",
							UpdateExpression: "SET readlist = :readlist",
							ExpressionAttributeValues: { ":uid": userId, ":readlist": readlist },
						},
			);
		},
		clearReadlistFromAddresses: async ({ userId, readlist }) => {
			const addresses = await listAddressesByUserId(userId);
			await Promise.all(
				addresses
					.filter((entry) => entry.readlist === readlist)
					.map(async (entry) => {
						try {
							await table.update({
								Key: { address: entry.address },
								ConditionExpression: "userId = :uid AND readlist = :readlist",
								UpdateExpression: "REMOVE readlist",
								ExpressionAttributeValues: { ":uid": userId, ":readlist": readlist },
							});
						} catch (error) {
							if (error instanceof ConditionalCheckFailedException) return;
							throw error;
						}
					}),
			);
		},
		findByAddress,
		tombstoneUserAddresses,
		getOrCreateReadlistAddress: async ({ userId, domain, readlist }) => {
			const existing = await findReadlistAddress({ userId, readlist });
			if (existing !== undefined) return existing;
			const minted = await mintAddress({
				userId,
				domain,
				name: GMAIL_FORWARDING_ALIAS,
				purpose: "gmail-readlist",
				readlist: readlist === DEFAULT_READLIST_SLUG ? undefined : readlist,
			});
			try {
				await claims.put({
					Item: {
						...readlistClaimKey({ userId, readlist }),
						claimOwner: userId,
						claimedAddress: minted.address,
						createdAt: minted.createdAt,
					},
					ConditionExpression: "attribute_not_exists(address)",
				});
				return minted;
			} catch (error) {
				if (!(error instanceof ConditionalCheckFailedException)) throw error;
			}
			await disableAddress({ userId, address: minted.address });
			const winner = await findReadlistAddress({ userId, readlist });
			assert(winner, "a lost readlist address claim must leave the winning claim in place");
			return winner;
		},
		findReadlistAddress,
		retireReadlistAddress: async ({ userId, readlist }) => {
			const claimedAddress = await findClaimedAddress({ userId, readlist });
			if (claimedAddress === undefined) return undefined;
			await disableAddress({ userId, address: claimedAddress });
			await releaseClaim({ userId, readlist, claimedAddress });
			return claimedAddress;
		},
		deleteReadlistAddressClaims: async (userId) => {
			const owned = await listAddressesByUserId(userId);
			await Promise.all(
				owned
					.filter((entry) => entry.purpose === "gmail-readlist")
					.map((entry) =>
						releaseClaim({
							userId,
							readlist: entry.readlist ?? DEFAULT_READLIST_SLUG,
							claimedAddress: entry.address,
						}),
					),
			);
		},
	};
}
