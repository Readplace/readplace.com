import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
	forEachQueryPage,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import {
	InboxAddressSchema,
	InboxEmailStatusSchema,
	type InboxEmailStore,
	MessageIdSchema,
} from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";

const InboxEmailRow = z.object({
	userId: UserIdSchema,
	receivedAtMessageId: z.string(),
	messageId: MessageIdSchema,
	recipientAddress: InboxAddressSchema,
	senderEmail: z.string(),
	subject: z.string(),
	status: InboxEmailStatusSchema,
	receivedAt: z.string(),
	rawEmailS3Key: z.string(),
	bodyS3Key: dynamoField(z.string()),
});

export function initDynamoDbInboxEmail(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): InboxEmailStore {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: InboxEmailRow,
	});

	return {
		putEmail: async (email) => {
			// The document client is not configured to drop undefined values, so a
			// rejected/unparsed row (no rendered body) must omit the attribute
			// entirely rather than write `bodyS3Key: undefined`.
			const { bodyS3Key, ...rest } = email;
			const Item = bodyS3Key === undefined ? rest : { ...rest, bodyS3Key };
			try {
				await table.put({
					Item,
					ConditionExpression: "attribute_not_exists(receivedAtMessageId)",
				});
				return "stored";
			} catch (error) {
				if (error instanceof ConditionalCheckFailedException) return "duplicate";
				throw error;
			}
		},
		listEmailsByUserId: async (userId) => {
			const { items } = await table.query({
				KeyConditionExpression: "userId = :uid",
				ExpressionAttributeValues: { ":uid": userId },
				ScanIndexForward: false,
			});
			return items;
		},
		getEmail: async ({ userId, receivedAtMessageId }) =>
			table.get({ userId, receivedAtMessageId }),
		deleteAllEmailsByUserId: async (userId) => {
			const receivedAtMessageIds: string[] = [];
			const rawEmailS3Keys: string[] = [];
			const bodyS3Keys: string[] = [];
			await forEachQueryPage(
				table,
				{
					KeyConditionExpression: "userId = :uid",
					ExpressionAttributeValues: { ":uid": userId },
				},
				async (rows) => {
					for (const row of rows) {
						receivedAtMessageIds.push(row.receivedAtMessageId);
						rawEmailS3Keys.push(row.rawEmailS3Key);
						if (row.bodyS3Key !== undefined) bodyS3Keys.push(row.bodyS3Key);
					}
					await Promise.all(
						rows.map((row) =>
							table.delete({
								Key: { userId, receivedAtMessageId: row.receivedAtMessageId },
							}),
						),
					);
				},
			);
			return { receivedAtMessageIds, rawEmailS3Keys, bodyS3Keys };
		},
	};
}
