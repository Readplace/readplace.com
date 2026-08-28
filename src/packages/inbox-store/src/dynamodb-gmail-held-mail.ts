import assert from "node:assert";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
	forEachQueryPage,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { ForwardableSenderSchema } from "@packages/domain/gmail";
import type { GmailHeldMailEntry, GmailHeldMailStore } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";

const SENDER_INDEX = "senderReceivedAt-index";

const GmailHeldMailRow = z.object({
	userId: UserIdSchema,
	receivedAtMessageId: z.string(),
	senderReceivedAt: z.string(),
	senderEmail: ForwardableSenderSchema,
	subject: z.string(),
	receivedAt: z.string(),
	rawEmailS3Key: z.string(),
	recipientAddress: InboxAddressSchema,
});

function toEntry(row: z.infer<typeof GmailHeldMailRow>): GmailHeldMailEntry {
	const { senderReceivedAt: _senderReceivedAt, ...entry } = row;
	return entry;
}

export function initDynamoDbGmailHeldMail(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): GmailHeldMailStore {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: GmailHeldMailRow,
	});

	const byUser = (userId: string) => ({
		KeyConditionExpression: "userId = :uid",
		ExpressionAttributeValues: { ":uid": userId },
	});

	return {
		holdMail: async (entry) => {
			try {
				await table.put({
					Item: {
						...entry,
						senderReceivedAt: `${entry.senderEmail}#${entry.receivedAtMessageId}`,
					},
					ConditionExpression: "attribute_not_exists(receivedAtMessageId)",
				});
				return "stored";
			} catch (error) {
				if (error instanceof ConditionalCheckFailedException) return "duplicate";
				throw error;
			}
		},
		listHeldMailBySender: async ({ userId, senderEmail, limit }) => {
			assert(Number.isInteger(limit), "limit must be an integer");
			assert(limit >= 1, "limit must be >= 1");
			const { items } = await table.query({
				IndexName: SENDER_INDEX,
				KeyConditionExpression: "userId = :uid AND begins_with(senderReceivedAt, :prefix)",
				ExpressionAttributeValues: { ":uid": userId, ":prefix": `${senderEmail}#` },
				ScanIndexForward: false,
				Limit: limit,
			});
			return items.map(toEntry);
		},
		deleteAllHeldMailByUserId: async (userId) => {
			await forEachQueryPage(table, byUser(userId), async (rows) => {
				await Promise.all(
					rows.map((row) =>
						table.delete({
							Key: { userId, receivedAtMessageId: row.receivedAtMessageId },
						}),
					),
				);
			});
		},
	};
}
