import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import {
	buildInboxAddress,
	generateInboxToken,
	INBOX_ADDRESS_MAX_CREATE_ATTEMPTS,
	InboxAddressSchema,
	type InboxAddressStore,
	InboxTokenSchema,
} from "@packages/domain/inbox";

const InboxAddressRow = z.object({
	address: InboxAddressSchema,
	userId: UserIdSchema,
	token: InboxTokenSchema,
	createdAt: z.string(),
	disabledAt: dynamoField(z.string()),
});

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

	return {
		createAddress: async ({ userId, domain }) => {
			const createdAt = deps.now().toISOString();
			for (let attempt = 0; attempt < INBOX_ADDRESS_MAX_CREATE_ATTEMPTS; attempt++) {
				const token = generateInboxToken();
				const address = buildInboxAddress({ token, domain });
				try {
					await table.put({
						Item: { address, userId, token, createdAt },
						ConditionExpression: "attribute_not_exists(address)",
					});
					return { address, userId, token, createdAt, disabledAt: undefined };
				} catch (error) {
					if (error instanceof ConditionalCheckFailedException) continue;
					throw error;
				}
			}
			throw new Error(
				`Failed to mint a unique inbox address after ${INBOX_ADDRESS_MAX_CREATE_ATTEMPTS} attempts`,
			);
		},
		listAddressesByUserId: async (userId) => {
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
			return items;
		},
		disableAddress: async ({ userId, address }) => {
			await table.update({
				Key: { address },
				ConditionExpression: "userId = :uid",
				UpdateExpression: "SET disabledAt = :now",
				ExpressionAttributeValues: { ":uid": userId, ":now": deps.now().toISOString() },
			});
		},
	};
}
