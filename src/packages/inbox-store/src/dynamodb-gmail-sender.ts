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
	additionalMappedAddresses: dynamoField(z.array(InboxAddressSchema)),
	mappedAt: dynamoField(z.string()),
});

function toSender(row: z.infer<typeof GmailSenderRow>): GmailSenderEntry {
	const { mappedAddress, additionalMappedAddresses, ...sender } = row;
	return {
		...sender,
		mappedAddresses: mappedAddress === undefined ? undefined : [mappedAddress, ...(additionalMappedAddresses ?? [])],
	};
}

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
		mapSenderToAddress: async ({ userId, senderEmail, mappedAddresses: [mappedAddress, ...additionalMappedAddresses] }) => {
			await table.update({
				Key: { userId, senderEmail },
				UpdateExpression: additionalMappedAddresses.length === 0
					? "SET mappedAddress = :addr, mappedAt = :now REMOVE additionalMappedAddresses"
					: "SET mappedAddress = :addr, mappedAt = :now, additionalMappedAddresses = :additional",
				ExpressionAttributeValues: {
					":addr": mappedAddress,
					":now": deps.now().toISOString(),
					...(additionalMappedAddresses.length === 0 ? {} : { ":additional": additionalMappedAddresses }),
				},
			});
		},
		findSender: async ({ userId, senderEmail }) => {
			const row = await table.get({ userId, senderEmail });
			return row === undefined ? undefined : toSender(row);
		},
		listSendersByUserId: async (userId) => {
			const senders: GmailSenderEntry[] = [];
			await forEachQueryPage(table, byUser(userId), async (rows) => {
				senders.push(...rows.map(toSender));
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
