import assert from "node:assert";
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
	type InboxEmailEntry,
	InboxEmailStatusSchema,
	type InboxEmailStore,
	MessageIdSchema,
	emailImageS3KeyPrefix,
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
		listEmailsByUserId: async ({ userId, page, pageSize }) => {
			assert(Number.isInteger(page), "page must be an integer");
			assert(page >= 1, "page must be >= 1");
			assert(Number.isInteger(pageSize), "pageSize must be an integer");
			assert(pageSize >= 1, "pageSize must be >= 1");

			let total = 0;
			let countStartKey: Record<string, unknown> | undefined;
			do {
				const { count, lastEvaluatedKey } = await table.query({
					KeyConditionExpression: "userId = :uid",
					ExpressionAttributeValues: { ":uid": userId },
					Select: "COUNT",
					ExclusiveStartKey: countStartKey,
				});
				total += count;
				countStartKey = lastEvaluatedKey;
			} while (countStartKey);

			const itemsToSkip = (page - 1) * pageSize;
			const emails: InboxEmailEntry[] = [];
			let skippedCount = 0;
			let exclusiveStartKey: Record<string, unknown> | undefined;
			do {
				const { items, lastEvaluatedKey } = await table.query({
					KeyConditionExpression: "userId = :uid",
					ExpressionAttributeValues: { ":uid": userId },
					ScanIndexForward: false,
					Limit: pageSize,
					ExclusiveStartKey: exclusiveStartKey,
				});
				for (const item of items) {
					if (skippedCount < itemsToSkip) {
						skippedCount++;
					} else if (emails.length < pageSize) {
						emails.push(item);
					}
				}
				exclusiveStartKey = lastEvaluatedKey;
			} while (
				exclusiveStartKey &&
				(skippedCount < itemsToSkip || emails.length < pageSize)
			);

			return { emails, total, page, pageSize };
		},
		getEmail: async ({ userId, receivedAtMessageId }) =>
			table.get({ userId, receivedAtMessageId }),
		listDeletionReferencesByUserId: async (userId) => {
			const receivedAtMessageIds: string[] = [];
			const rawEmailS3Keys: string[] = [];
			const bodyS3Keys: string[] = [];
			const emailImageS3KeyPrefixes: string[] = [];
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
						// Every row, not just bodied ones: a crash between the image
						// uploads and the body write may leave images under a prefix whose
						// row never gained a bodyS3Key, and listing an empty prefix is
						// cheaper than orphaning PII.
						emailImageS3KeyPrefixes.push(
							emailImageS3KeyPrefix({
								userId,
								receivedAtMessageId: row.receivedAtMessageId,
							}),
						);
					}
				},
			);
			return { receivedAtMessageIds, rawEmailS3Keys, bodyS3Keys, emailImageS3KeyPrefixes };
		},
		deleteAllEmailsByUserId: async (userId) => {
			await forEachQueryPage(
				table,
				{
					KeyConditionExpression: "userId = :uid",
					ExpressionAttributeValues: { ":uid": userId },
				},
				async (rows) => {
					await Promise.all(
						rows.map((row) =>
							table.delete({
								Key: { userId, receivedAtMessageId: row.receivedAtMessageId },
							}),
						),
					);
				},
			);
		},
	};
}
