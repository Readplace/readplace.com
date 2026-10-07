import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
	forEachQueryPage,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { ForwardableSenderSchema, GmailAccountEmailSchema, GmailDeliveryModeSchema } from "@packages/domain/gmail";
import type { ForwardableSender, GmailAccountEmail, GmailMapping, GmailMappingStore } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";

const GmailMappingRow = z.object({
	userId: UserIdSchema,
	mappingKey: z.string(),
	accountEmail: GmailAccountEmailSchema,
	senderEmail: ForwardableSenderSchema,
	addedToFilterAt: dynamoField(z.string()),
	mappedAddress: dynamoField(InboxAddressSchema),
	additionalMappedAddresses: dynamoField(z.array(InboxAddressSchema)),
	mappedAt: dynamoField(z.string()),
	deliveryMode: dynamoField(GmailDeliveryModeSchema),
});

function accountPrefix(accountEmail: GmailAccountEmail) {
	return `${accountEmail}#`;
}

function toMapping(row: z.infer<typeof GmailMappingRow>): GmailMapping {
	const { userId: _userId, mappingKey: _mappingKey, mappedAddress, additionalMappedAddresses, ...mapping } = row;
	return {
		...mapping,
		mappedAddresses: mappedAddress === undefined ? undefined : [mappedAddress, ...(additionalMappedAddresses ?? [])],
	};
}

export function initDynamoDbGmailMapping(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	now: () => Date;
}): GmailMappingStore {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: GmailMappingRow,
	});

	const keyOf = (input: { userId: string; accountEmail: GmailAccountEmail; senderEmail: ForwardableSender }) => ({
		userId: input.userId,
		mappingKey: `${accountPrefix(input.accountEmail)}${input.senderEmail}`,
	});

	const byUser = (userId: string) => ({
		KeyConditionExpression: "userId = :uid",
		ExpressionAttributeValues: { ":uid": userId },
	});

	const list = async (query: Parameters<typeof table.query>[0]) => {
		const mappings: GmailMapping[] = [];
		await forEachQueryPage(table, query, async (rows) => {
			mappings.push(...rows.map(toMapping));
		});
		return mappings;
	};

	return {
		addSenderToFilter: async ({ userId, accountEmail, senderEmail }) => {
			await table.update({
				Key: keyOf({ userId, accountEmail, senderEmail }),
				UpdateExpression:
					"SET accountEmail = :account, senderEmail = :sender, addedToFilterAt = if_not_exists(addedToFilterAt, :now)",
				ExpressionAttributeValues: { ":account": accountEmail, ":sender": senderEmail, ":now": deps.now().toISOString() },
			});
		},
		mapSenderToAddress: async ({ userId, accountEmail, senderEmail, mappedAddresses: [mappedAddress, ...additionalMappedAddresses], deliveryMode }) => {
			await table.update({
				Key: keyOf({ userId, accountEmail, senderEmail }),
				UpdateExpression: additionalMappedAddresses.length === 0
					? "SET accountEmail = :account, senderEmail = :sender, mappedAddress = :addr, mappedAt = :now, deliveryMode = :mode REMOVE additionalMappedAddresses"
					: "SET accountEmail = :account, senderEmail = :sender, mappedAddress = :addr, mappedAt = :now, deliveryMode = :mode, additionalMappedAddresses = :additional",
				ExpressionAttributeValues: {
					":account": accountEmail,
					":sender": senderEmail,
					":addr": mappedAddress,
					":now": deps.now().toISOString(),
					":mode": deliveryMode,
					...(additionalMappedAddresses.length === 0 ? {} : { ":additional": additionalMappedAddresses }),
				},
			});
		},
		findMapping: async ({ userId, accountEmail, senderEmail }) => {
			const row = await table.get(keyOf({ userId, accountEmail, senderEmail }));
			return row === undefined ? undefined : toMapping(row);
		},
		listMappings: ({ userId, accountEmail }) =>
			list({
				KeyConditionExpression: "userId = :uid AND begins_with(mappingKey, :account)",
				ExpressionAttributeValues: { ":uid": userId, ":account": accountPrefix(accountEmail) },
			}),
		listMappingsByUserId: (userId) => list(byUser(userId)),
		removeMapping: async ({ userId, accountEmail, senderEmail }) => {
			await table.delete({ Key: keyOf({ userId, accountEmail, senderEmail }) });
		},
		deleteAllByUserId: async (userId) => {
			await forEachQueryPage(table, byUser(userId), async (rows) => {
				await Promise.all(rows.map((row) => table.delete({ Key: { userId, mappingKey: row.mappingKey } })));
			});
		},
	};
}
