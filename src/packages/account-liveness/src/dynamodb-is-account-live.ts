import { type DynamoDBDocumentClient, defineDynamoTable, dynamoField } from "@packages/storage-client";
import type { IsAccountLive } from "@packages/provider-contracts/auth";
import { z } from "zod";

const UserIndexRow = z.object({ email: z.string() });

const UserRow = z.object({
	userId: z.string(),
	deletedAt: dynamoField(z.string()),
});

export function initDynamoDbIsAccountLive(deps: {
	client: Pick<DynamoDBDocumentClient, "send">;
	usersTableName: string;
}): IsAccountLive {
	const byUserId = defineDynamoTable({ client: deps.client, tableName: deps.usersTableName, schema: UserIndexRow });
	const users = defineDynamoTable({ client: deps.client, tableName: deps.usersTableName, schema: UserRow });

	return async (userId) => {
		const { items } = await byUserId.query({
			IndexName: "userId-index",
			KeyConditionExpression: "userId = :userId",
			ExpressionAttributeValues: { ":userId": userId },
			ProjectionExpression: "email",
			Limit: 1,
		});
		const indexed = items[0];
		if (indexed === undefined) return false;
		const row = await users.get({ email: indexed.email }, { projection: ["userId", "deletedAt"], consistentRead: true });
		return row !== undefined && row.userId === userId && row.deletedAt === undefined;
	};
}
