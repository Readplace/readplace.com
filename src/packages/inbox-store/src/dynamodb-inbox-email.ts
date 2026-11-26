import assert from "node:assert";
import {
	writeIfCondition,
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
	forEachQueryPage,
} from "@packages/storage-client";
import { z } from "zod";
import {
	InboxAddressSchema,
	type InboxEmailEntry,
	InboxEmailStatusSchema,
	type InboxEmailStore,
	MessageIdSchema,
	emailImageS3KeyPrefix,
	EmailDeliveryModeSchema,
} from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";

const InboxEmailRow = z.object({
	userId: UserIdSchema,
	receivedAtMessageId: z.string(),
	messageId: MessageIdSchema,
	recipientAddress: InboxAddressSchema,
	gmailDestinationAddresses: dynamoField(z.tuple([InboxAddressSchema], InboxAddressSchema)),
	gmailDeliveryMode: dynamoField(EmailDeliveryModeSchema),
	senderEmail: z.string(),
	subject: z.string(),
	status: InboxEmailStatusSchema,
	receivedAt: z.string(),
	rawEmailS3Key: z.string(),
	bodyS3Key: dynamoField(z.string()),
	linkCounts: dynamoField(
		z.object({
			kept: z.number().int().min(0),
			skipped: z.number().int().min(0),
			truncated: z.boolean(),
		}),
	),
});

const MessageIdIndexRow = z.object({
	receivedAtMessageId: z.string(),
	senderEmail: z.string(),
	status: InboxEmailStatusSchema,
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
	const receivedSenders = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: InboxEmailRow.pick({ senderEmail: true }),
	});
	const messageIdIndex = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: MessageIdIndexRow,
	});

	return {
		putEmail: async (email) => {
			// The document client is not configured to drop undefined values, so a
			// rejected/unparsed row (no rendered body) must omit the attribute
			// entirely rather than write `bodyS3Key: undefined`.
			const { bodyS3Key, linkCounts, ...rest } = email;
			const Item = {
				...rest,
				...(bodyS3Key === undefined ? {} : { bodyS3Key }),
				...(linkCounts === undefined ? {} : { linkCounts }),
			};
			const outcome = await writeIfCondition(() => table.put({
				Item,
				ConditionExpression: "attribute_not_exists(receivedAtMessageId)",
			}));
			if (outcome.kind === "condition-failed") return "duplicate";
			return "stored";
		},
		listReceivedSenders: async (userId) => {
			const senders = new Set<string>();
			await forEachQueryPage(receivedSenders, {
				KeyConditionExpression: "userId = :uid",
				FilterExpression: "#status = :received",
				ProjectionExpression: "senderEmail",
				ExpressionAttributeNames: { "#status": "status" },
				ExpressionAttributeValues: { ":uid": userId, ":received": "received" },
			}, async (rows) => {
				for (const { senderEmail } of rows) {
					if (senderEmail !== "") senders.add(senderEmail);
				}
			});
			return [...senders].sort();
		},
		listEmailsByUserId: async ({ userId, cursor, pageSize, sender }) => {
			assert(Number.isInteger(pageSize), "pageSize must be an integer");
			assert(pageSize >= 1, "pageSize must be >= 1");
			assert(
				cursor === undefined || cursor.receivedAtMessageId !== "",
				"cursor must name a boundary row",
			);

			const probeLimit = pageSize + 1;
			const descending = cursor?.direction !== "newer";
			const collected: InboxEmailEntry[] = [];
			let exclusiveStartKey: Record<string, unknown> | undefined =
				cursor === undefined
					? undefined
					: { userId, receivedAtMessageId: cursor.receivedAtMessageId };
			do {
				const { items, lastEvaluatedKey } = await table.query({
					KeyConditionExpression: "userId = :uid",
					...(sender === undefined ? { ExpressionAttributeValues: { ":uid": userId } } : {
						FilterExpression: "senderEmail = :sender AND #status = :received",
						ExpressionAttributeNames: { "#status": "status" },
						ExpressionAttributeValues: { ":uid": userId, ":sender": sender, ":received": "received" },
					}),
					ScanIndexForward: !descending,
					Limit: sender === undefined ? probeLimit - collected.length : 100,
					ExclusiveStartKey: exclusiveStartKey,
				});
				collected.push(...items);
				exclusiveStartKey = lastEvaluatedKey;
			} while (collected.length < probeLimit && exclusiveStartKey);

			const emails = collected.slice(0, pageSize);
			const hasMore = collected.length > pageSize;
			if (descending) {
				return { emails, hasNewer: cursor !== undefined, hasOlder: hasMore };
			}
			return { emails: emails.reverse(), hasNewer: hasMore, hasOlder: true };
		},
		getEmail: async ({ userId, receivedAtMessageId }) =>
			table.get({ userId, receivedAtMessageId }, { consistentRead: true }),
		setEmailLinkCounts: async ({ userId, receivedAtMessageId, linkCounts, window }) => {
			if (window) {
				const first = window.start === 0;
				await writeIfCondition(() => table.update({
					Key: { userId, receivedAtMessageId },
					ConditionExpression: first
						? "attribute_exists(receivedAtMessageId) AND attribute_not_exists(countedThrough)"
						: "countedThrough = :start",
					UpdateExpression: first ? "SET countedThrough = :end, linkCounts = :counts"
						: "SET countedThrough = :end, linkCounts.kept = linkCounts.kept + :kept, linkCounts.skipped = linkCounts.skipped + :skipped, linkCounts.truncated = :truncated",
					ExpressionAttributeValues: first ? { ":end": window.end, ":counts": linkCounts }
						: { ":end": window.end, ":start": window.start, ":kept": linkCounts.kept, ":skipped": linkCounts.skipped, ":truncated": linkCounts.truncated },
				}));
				return;
			}
			await table.update({
				Key: { userId, receivedAtMessageId },
				ConditionExpression: "attribute_exists(receivedAtMessageId)",
				UpdateExpression: "SET linkCounts = :linkCounts",
				ExpressionAttributeValues: { ":linkCounts": linkCounts },
			});
		},
		moveLinkCountToKept: async ({ userId, receivedAtMessageId }) => {
			await table.update({
				Key: { userId, receivedAtMessageId },
				ConditionExpression: "attribute_exists(linkCounts)",
				UpdateExpression: "ADD linkCounts.kept :one, linkCounts.skipped :minusOne",
				ExpressionAttributeValues: { ":one": 1, ":minusOne": -1 },
			});
		},
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
		findReceivedByMessageId: async ({ userId, messageId }) => {
			const received: { receivedAtMessageId: string; senderEmail: string }[] = [];
			await forEachQueryPage(
				messageIdIndex,
				{
					IndexName: "messageId-index",
					KeyConditionExpression: "messageId = :messageId AND userId = :uid",
					FilterExpression: "#status = :received",
					ExpressionAttributeNames: { "#status": "status" },
					ExpressionAttributeValues: { ":messageId": messageId, ":uid": userId, ":received": "received" },
				},
				async (rows) => {
					for (const row of rows) {
						received.push({ receivedAtMessageId: row.receivedAtMessageId, senderEmail: row.senderEmail });
					}
				},
			);
			return received;
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
