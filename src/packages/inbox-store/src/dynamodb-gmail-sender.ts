import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
	forEachQueryPage,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { ForwardableSenderSchema } from "@packages/domain/gmail";
import type { GmailSenderEntry, GmailSenderStore } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";

const GmailSenderRow = z.object({
	userId: UserIdSchema,
	senderEmail: ForwardableSenderSchema,
	addedToFilterAt: dynamoField(z.string()),
	firstSeenAt: dynamoField(z.string()),
	lastSeenAt: dynamoField(z.string()),
	seenCount: dynamoField(z.number()),
	lastSubject: dynamoField(z.string()),
	mappedAddress: dynamoField(InboxAddressSchema),
	mappedAt: dynamoField(z.string()),
});

export function initDynamoDbGmailSender(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	now: () => Date;
}): GmailSenderStore {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: GmailSenderRow,
	});

	const byUser = (userId: string) => ({
		KeyConditionExpression: "userId = :uid",
		ExpressionAttributeValues: { ":uid": userId },
	});

	return {
		addSenderToFilter: async ({ userId, senderEmail }) => {
			await table.update({
				Key: { userId, senderEmail },
				UpdateExpression: "SET addedToFilterAt = if_not_exists(addedToFilterAt, :now)",
				ExpressionAttributeValues: { ":now": deps.now().toISOString() },
			});
		},
		recordSenderSeen: async ({ userId, senderEmail, subject }) => {
			const now = deps.now().toISOString();
			await table.update({
				Key: { userId, senderEmail },
				UpdateExpression:
					"SET firstSeenAt = if_not_exists(firstSeenAt, :now), lastSeenAt = :now, lastSubject = :subject ADD seenCount :one",
				ExpressionAttributeValues: { ":now": now, ":subject": subject, ":one": 1 },
			});
		},
		mapSenderToAddress: async ({ userId, senderEmail, mappedAddress }) => {
			await table.update({
				Key: { userId, senderEmail },
				UpdateExpression: "SET mappedAddress = :addr, mappedAt = :now",
				ExpressionAttributeValues: {
					":addr": mappedAddress,
					":now": deps.now().toISOString(),
				},
			});
		},
		findSender: async ({ userId, senderEmail }) => table.get({ userId, senderEmail }),
		listSendersByUserId: async (userId) => {
			const senders: GmailSenderEntry[] = [];
			await forEachQueryPage(table, byUser(userId), async (rows) => {
				senders.push(...rows);
			});
			return senders;
		},
		removeSender: async ({ userId, senderEmail }) => {
			await table.delete({ Key: { userId, senderEmail } });
		},
		deleteAllSendersByUserId: async (userId) => {
			await forEachQueryPage(table, byUser(userId), async (rows) => {
				await Promise.all(
					rows.map((row) =>
						table.delete({ Key: { userId, senderEmail: row.senderEmail } }),
					),
				);
			});
		},
	};
}
