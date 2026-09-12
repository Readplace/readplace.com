import {
	ConditionalCheckFailedException,
	TransactionCanceledException,
	TransactWriteCommand,
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
	forEachQueryPage,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { ForwardableSenderSchema, GmailAccountEmailSchema, type GmailDiscovery, type GmailDiscoveryStore } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";

const StateRow = z.object({
	userId: UserIdSchema,
	accountEmail: GmailAccountEmailSchema,
	gatewayAddress: InboxAddressSchema,
	generation: z.string(),
	state: z.enum(["running", "complete", "failed"]),
	mode: z.enum(["profile", "full", "history"]),
	page: z.number(),
	pageToken: dynamoField(z.string()),
	historyId: dynamoField(z.string()),
	scannedCount: z.number(),
	estimatedTotalMessages: dynamoField(z.number()),
	updatedAt: z.string(),
	error: dynamoField(z.string()),
	requiresReconnect: z.boolean().default(false),
});

const SenderRow = z.object({
	userId: UserIdSchema,
	recordKey: z.string(),
	email: ForwardableSenderSchema,
	name: dynamoField(z.string()),
});

async function conditionalWrite(write: () => Promise<unknown>): Promise<boolean> {
	try {
		await write();
		return true;
	} catch (error) {
		if (error instanceof ConditionalCheckFailedException) return false;
		if (error instanceof TransactionCanceledException && error.CancellationReasons?.some((reason) => reason.Code === "ConditionalCheckFailed")) return false;
		throw error;
	}
}

export function initDynamoDbGmailDiscovery(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	now: () => Date;
}): GmailDiscoveryStore {
	const states = defineDynamoTable({ client: deps.client, tableName: deps.tableName, schema: StateRow });
	const senders = defineDynamoTable({ client: deps.client, tableName: deps.tableName, schema: SenderRow });
	const senderQuery = (userId: string) => ({
		KeyConditionExpression: "userId = :uid AND begins_with(recordKey, :prefix)",
		ExpressionAttributeValues: { ":uid": userId, ":prefix": "SENDER#" },
		ConsistentRead: true,
	});
	return {
		findDiscoveryByUserId: async (userId) => states.get({ userId, recordKey: "STATE" }, { consistentRead: true }),
		listSendersByUserId: async (userId) => {
			const found: { email: z.infer<typeof ForwardableSenderSchema>; name: string | undefined }[] = [];
			await forEachQueryPage(senders, senderQuery(userId), async (rows) => {
				for (const row of rows) found.push({ email: row.email, name: row.name });
			});
			return found;
		},
		startDiscovery: async ({ resume, ...input }) => conditionalWrite(() => states.put({
			Item: {
				...input,
				recordKey: "STATE",
				state: "running",
				page: resume?.page ?? 0,
				pageToken: resume?.pageToken,
				scannedCount: resume?.scannedCount ?? 0,
				estimatedTotalMessages: resume?.estimatedTotalMessages,
				updatedAt: deps.now().toISOString(),
				requiresReconnect: false,
			},
			ConditionExpression: "attribute_not_exists(userId) OR #state <> :running",
			ExpressionAttributeNames: { "#state": "state" },
			ExpressionAttributeValues: { ":running": "running" },
		})),
		claimPage: async ({ userId, generation, page }) => conditionalWrite(() => states.update({
			Key: { userId, recordKey: "STATE" },
			UpdateExpression: "SET claimUntil = :until",
			ConditionExpression: "generation = :generation AND #page = :page AND #state = :running AND (attribute_not_exists(claimUntil) OR claimUntil <= :now)",
			ExpressionAttributeNames: { "#state": "state", "#page": "page" },
			ExpressionAttributeValues: {
				":generation": generation,
				":page": page,
				":running": "running",
				":now": deps.now().getTime(),
				":until": deps.now().getTime() + 60_000,
			},
		})),
		savePage: async ({ previous, senders: pageSenders, mode, pageToken, historyId, state, scannedMessages, estimatedTotalMessages }) => {
			const updated: GmailDiscovery = {
				...previous,
				mode,
				pageToken,
				historyId,
				state,
				page: previous.page + 1,
				scannedCount: mode === "profile" ? scannedMessages : previous.scannedCount + scannedMessages,
				estimatedTotalMessages,
				updatedAt: deps.now().toISOString(),
				error: undefined,
				requiresReconnect: false,
			};
			const uniqueSenders = new Map(pageSenders.map((sender) => [sender.email, sender]));
			const senderWrites = [...uniqueSenders.values()].map((sender) => ({
				Put: { TableName: deps.tableName, Item: { userId: previous.userId, recordKey: `SENDER#${sender.email}`, ...sender } },
			}));
			while (senderWrites.length > 99) {
				const committed = await conditionalWrite(() => deps.client.send(new TransactWriteCommand({
					TransactItems: [
						{
							ConditionCheck: {
								TableName: deps.tableName,
								Key: { userId: previous.userId, recordKey: "STATE" },
								ConditionExpression: "generation = :generation AND #page = :page AND #state = :running",
								ExpressionAttributeNames: { "#state": "state", "#page": "page" },
								ExpressionAttributeValues: { ":generation": previous.generation, ":page": previous.page, ":running": "running" },
							},
						},
						...senderWrites.splice(0, 99),
					],
				})));
				if (!committed) return false;
			}
			return conditionalWrite(() => deps.client.send(new TransactWriteCommand({
				TransactItems: [
					{
						Put: {
							TableName: deps.tableName,
							Item: { ...updated, recordKey: "STATE" },
							ConditionExpression: "generation = :generation AND #page = :page AND #state = :running",
							ExpressionAttributeNames: { "#state": "state", "#page": "page" },
							ExpressionAttributeValues: { ":generation": previous.generation, ":page": previous.page, ":running": "running" },
						},
					},
					...senderWrites,
				],
			})));
		},
		failDiscovery: async ({ userId, generation, error, requiresReconnect = false }) => {
			await conditionalWrite(() => states.update({
				Key: { userId, recordKey: "STATE" },
				UpdateExpression: "SET #state = :failed, #error = :error, requiresReconnect = :requiresReconnect, updatedAt = :now REMOVE claimUntil",
				ConditionExpression: "generation = :generation AND #state = :running",
				ExpressionAttributeNames: { "#state": "state", "#error": "error" },
				ExpressionAttributeValues: { ":generation": generation, ":running": "running", ":failed": "failed", ":error": error, ":requiresReconnect": requiresReconnect, ":now": deps.now().toISOString() },
			}));
		},
		deleteDiscoveryByUserId: async (userId) => {
			await states.delete({ Key: { userId, recordKey: "STATE" } });
			await forEachQueryPage(senders, senderQuery(userId), async (rows) => {
				await Promise.all(rows.map((row) => senders.delete({ Key: { userId, recordKey: row.recordKey } })));
			});
		},
	};
}
