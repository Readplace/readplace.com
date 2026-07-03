import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import {
	aliasNameFromAddress,
	AliasNameSchema,
	buildInboxAddress,
	countLiveAddresses,
	generateInboxToken,
	INBOX_ADDRESS_MAX_CREATE_ATTEMPTS,
	INBOX_ADDRESS_MAX_PER_USER,
	InboxAddressLimitReachedError,
	type InboxAddressEntry,
	InboxAddressSchema,
	type InboxAddressStore,
	InboxTokenSchema,
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
});

/** The one seam that turns a stored row into a fully-populated entry, deriving
 * the alias label for a legacy row that predates the `name` column so every
 * caller sees a labelled address. */
function toEntry(row: z.infer<typeof InboxAddressRow>): InboxAddressEntry {
	return {
		address: row.address,
		userId: row.userId,
		name: row.name ?? aliasNameFromAddress(row.address),
		token: row.token,
		createdAt: row.createdAt,
		disabledAt: row.disabledAt,
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

	return {
		createAddress: async ({ userId, domain, name }) => {
			// Bound the live addresses a user can hold. disabledAt is not a key
			// attribute, so the cap is counted in code over the GSI rows rather than
			// pushed into a COUNT query. The GSI is eventually consistent, so this is a
			// soft guardrail (a racing pair of creates may briefly land one over the
			// cap) — fine, since the cap exists to stop an unbounded create loop, not
			// to enforce an exact-to-the-row ceiling.
			const liveCount = countLiveAddresses(await listAddressesByUserId(userId));
			if (liveCount >= INBOX_ADDRESS_MAX_PER_USER) {
				throw new InboxAddressLimitReachedError(INBOX_ADDRESS_MAX_PER_USER);
			}
			const createdAt = deps.now().toISOString();
			for (let attempt = 0; attempt < INBOX_ADDRESS_MAX_CREATE_ATTEMPTS; attempt++) {
				const token = generateInboxToken();
				const address = buildInboxAddress({ name, token, domain });
				try {
					await table.put({
						Item: { address, userId, name, token, createdAt },
						ConditionExpression: "attribute_not_exists(address)",
					});
					return { address, userId, name, token, createdAt, disabledAt: undefined };
				} catch (error) {
					if (error instanceof ConditionalCheckFailedException) continue;
					throw error;
				}
			}
			throw new Error(
				`Failed to mint a unique inbox address after ${INBOX_ADDRESS_MAX_CREATE_ATTEMPTS} attempts`,
			);
		},
		listAddressesByUserId,
		disableAddress: async ({ userId, address }) => {
			await table.update({
				Key: { address },
				ConditionExpression: "userId = :uid",
				UpdateExpression: "SET disabledAt = :now",
				ExpressionAttributeValues: { ":uid": userId, ":now": deps.now().toISOString() },
			});
		},
		findByAddress: async (address) => {
			const row = await table.get({ address });
			return row === undefined ? undefined : toEntry(row);
		},
	};
}
