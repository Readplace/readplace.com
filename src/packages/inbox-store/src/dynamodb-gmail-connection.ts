import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import type { GmailConnection, GmailConnectionStore } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";

const CONNECTED_INDEX = "connected-index";
const CONNECTED_MARKER = "yes";

const GmailFilterErrorRow = z.object({
	code: z.enum(["query-too-long", "rejected"]),
	message: z.string(),
	at: z.string(),
});

const GmailConnectionRow = z.object({
	userId: UserIdSchema,
	gatewayAddress: InboxAddressSchema,
	connectedAt: z.string(),
	forwardingConfirmedAt: dynamoField(z.string()),
	filterId: dynamoField(z.string()),
	filterQuery: dynamoField(z.string()),
	filterSenderCount: dynamoField(z.number()),
	filterUpdatedAt: dynamoField(z.string()),
	lastFilterError: dynamoField(GmailFilterErrorRow),
	revokedAt: dynamoField(z.string()),
	revokedReason: dynamoField(z.enum(["invalid-grant", "scope-not-granted", "user-disconnected"])),
	connected: dynamoField(z.string()),
});

function toConnection(row: z.infer<typeof GmailConnectionRow>): GmailConnection {
	return {
		userId: row.userId,
		gatewayAddress: row.gatewayAddress,
		connectedAt: row.connectedAt,
		forwardingConfirmedAt: row.forwardingConfirmedAt,
		filterId: row.filterId,
		filterQuery: row.filterQuery,
		filterSenderCount: row.filterSenderCount,
		filterUpdatedAt: row.filterUpdatedAt,
		lastFilterError: row.lastFilterError,
		revokedAt: row.revokedAt,
		revokedReason: row.revokedReason,
	};
}

export function initDynamoDbGmailConnection(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	now: () => Date;
}): GmailConnectionStore {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: GmailConnectionRow,
	});

	return {
		createConnection: async ({ userId, gatewayAddress }) => {
			const connectedAt = deps.now().toISOString();
			await table.put({
				Item: {
					userId,
					gatewayAddress,
					connectedAt,
					connected: CONNECTED_MARKER,
				},
			});
			return {
				userId,
				gatewayAddress,
				connectedAt,
				forwardingConfirmedAt: undefined,
				filterId: undefined,
				filterQuery: undefined,
				filterSenderCount: undefined,
				filterUpdatedAt: undefined,
				lastFilterError: undefined,
				revokedAt: undefined,
				revokedReason: undefined,
			};
		},
		findConnectionByUserId: async (userId) => {
			const row = await table.get({ userId });
			return row === undefined ? undefined : toConnection(row);
		},
		markForwardingConfirmed: async ({ userId }) => {
			await table.update({
				Key: { userId },
				UpdateExpression:
					"SET forwardingConfirmedAt = if_not_exists(forwardingConfirmedAt, :now)",
				ExpressionAttributeValues: { ":now": deps.now().toISOString() },
			});
		},
		clearForwardingConfirmed: async ({ userId }) => {
			await table.update({
				Key: { userId },
				UpdateExpression: "REMOVE forwardingConfirmedAt",
			});
		},
		recordFilter: async ({ userId, filterId, filterQuery, filterSenderCount }) => {
			await table.update({
				Key: { userId },
				UpdateExpression:
					"SET filterId = :id, filterQuery = :q, filterSenderCount = :n, filterUpdatedAt = :now REMOVE lastFilterError",
				ExpressionAttributeValues: {
					":id": filterId,
					":q": filterQuery,
					":n": filterSenderCount,
					":now": deps.now().toISOString(),
				},
			});
		},
		clearFilter: async ({ userId }) => {
			await table.update({
				Key: { userId },
				UpdateExpression:
					"REMOVE filterId, filterQuery, filterSenderCount, filterUpdatedAt, lastFilterError",
			});
		},
		recordFilterError: async ({ userId, error }) => {
			await table.update({
				Key: { userId },
				UpdateExpression: "SET lastFilterError = :err",
				ExpressionAttributeValues: { ":err": error },
			});
		},
		markRevoked: async ({ userId, reason }) => {
			await table.update({
				Key: { userId },
				UpdateExpression: "SET revokedAt = :now, revokedReason = :reason REMOVE connected",
				ExpressionAttributeValues: { ":now": deps.now().toISOString(), ":reason": reason },
			});
		},
		clearRevoked: async ({ userId }) => {
			await table.update({
				Key: { userId },
				UpdateExpression: "SET connected = :c REMOVE revokedAt, revokedReason",
				ExpressionAttributeValues: { ":c": CONNECTED_MARKER },
			});
		},
		deleteConnection: async (userId) => {
			await table.delete({ Key: { userId } });
		},
		countConnected: async () => {
			const { count } = await table.query({
				IndexName: CONNECTED_INDEX,
				KeyConditionExpression: "connected = :c",
				ExpressionAttributeValues: { ":c": CONNECTED_MARKER },
				Select: "COUNT",
			});
			return count;
		},
	};
}
