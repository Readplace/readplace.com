import { ConditionalCheckFailedException, TransactionCanceledException, TransactWriteCommand, defineDynamoTable, dynamoField, forEachQueryPage, type DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { z } from "zod";
import { ForwardableSenderSchema, GmailAccountEmailSchema, type DiscoveredGmailSender } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import type { GmailMonitoringCheckpoint, GmailMonitoringStore } from "@packages/provider-contracts/gmail-monitoring";

const CheckpointRow = z.object({
	userId: UserIdSchema, key: z.string(), generation: z.string(), page: z.number(),
	mailboxId: z.string(), accountEmail: GmailAccountEmailSchema, gatewayAddress: InboxAddressSchema,
	mode: z.enum(["profile", "discovered", "baseline", "arrivals", "reconcile", "notices", "complete"]),
	initializing: z.boolean(), historyId: dynamoField(z.string()), pageToken: dynamoField(z.string()), scannedCount: z.number(), lastCheckedAt: z.number(), noticesToDispatch: z.array(ForwardableSenderSchema).optional(),
});
const ObservationRow = z.object({ userId: UserIdSchema, key: z.string(), email: ForwardableSenderSchema, name: dynamoField(z.string()), approved: z.boolean(), lastMessageAt: z.number().optional() });
const EmailRow = z.object({ from: z.string(), to: z.string(), subject: z.string(), html: z.string(), text: z.string().optional(), bcc: z.string().optional(), replyTo: z.string().optional(), headers: z.record(z.string(), z.string()).optional(), idempotencyKey: z.string().optional() });
const NoticeRow = z.object({
	userId: UserIdSchema, key: z.string(), senderEmail: ForwardableSenderSchema, accountEmail: GmailAccountEmailSchema,
	gatewayAddress: InboxAddressSchema, mailboxId: z.string(), status: z.enum(["pending", "sending", "sent", "cancelled"]),
	message: dynamoField(EmailRow), firstAttemptAt: dynamoField(z.number()), claimUntil: dynamoField(z.number()),
});
const NoticeBatchRow = z.object({
	userId: UserIdSchema, key: z.string(), status: z.enum(["idle", "sending"]), senders: dynamoField(z.array(ForwardableSenderSchema)),
	message: dynamoField(EmailRow), firstAttemptAt: dynamoField(z.number()), claimUntil: dynamoField(z.number()), lastSentAt: dynamoField(z.number()),
});
const ClaimedNoticeBatch = z.object({ userId: UserIdSchema, status: z.literal("sending"), senders: z.array(ForwardableSenderSchema), message: EmailRow, firstAttemptAt: z.number(), claimUntil: z.number() });
const NoticeBatch = z.discriminatedUnion("status", [z.object({ userId: UserIdSchema, status: z.literal("idle"), lastSentAt: z.number() }), ClaimedNoticeBatch]);
const NOTICE_BATCH_KEY = "NOTICE_BATCH";
const Cursor = z.object({ userId: z.string(), key: z.string() });

async function conditional(write: () => Promise<unknown>): Promise<boolean> {
	try { await write(); return true; } catch (error) {
		if (error instanceof ConditionalCheckFailedException) return false;
		if (error instanceof TransactionCanceledException && error.CancellationReasons?.some((reason) => reason.Code === "ConditionalCheckFailed")) return false;
		throw error;
	}
}

export function initDynamoDbGmailMonitoring(deps: { client: DynamoDBDocumentClient; tableName: string; now: () => Date }): GmailMonitoringStore {
	const checkpoints = defineDynamoTable({ client: deps.client, tableName: deps.tableName, schema: CheckpointRow });
	const observations = defineDynamoTable({ client: deps.client, tableName: deps.tableName, schema: ObservationRow });
	const notices = defineDynamoTable({ client: deps.client, tableName: deps.tableName, schema: NoticeRow });
	const batches = defineDynamoTable({ client: deps.client, tableName: deps.tableName, schema: NoticeBatchRow });
	const keys = defineDynamoTable({ client: deps.client, tableName: deps.tableName, schema: Cursor });
	const fence = (checkpoint: GmailMonitoringCheckpoint) => ({
		ConditionExpression: "generation = :generation AND #page = :page",
		ExpressionAttributeNames: { "#page": "page" },
		ExpressionAttributeValues: { ":generation": checkpoint.generation, ":page": checkpoint.page },
	});
	const query = (input: { userId: string; prefix: string; pageToken?: string }) => ({
		KeyConditionExpression: "userId = :uid AND begins_with(#key, :prefix)",
		ExpressionAttributeNames: { "#key": "key" }, ExpressionAttributeValues: { ":uid": input.userId, ":prefix": input.prefix },
		ConsistentRead: true, Limit: 25,
		ExclusiveStartKey: input.pageToken === undefined ? undefined : Cursor.parse(JSON.parse(Buffer.from(input.pageToken, "base64url").toString())),
	});
	const token = (key: Record<string, unknown> | undefined) => key === undefined ? undefined : Buffer.from(JSON.stringify(key)).toString("base64url");
	return {
		findCheckpoint: async (userId) => checkpoints.get({ userId, key: "STATE" }, { consistentRead: true }),
		startRun: async ({ checkpoint, previous }) => conditional(() => checkpoints.put({
			Item: { ...checkpoint, key: "STATE" },
			...(previous === undefined ? { ConditionExpression: "attribute_not_exists(userId)" } : fence(previous)),
		})),
		claimPage: async ({ userId, generation, page }) => conditional(() => checkpoints.update({
			Key: { userId, key: "STATE" },
			UpdateExpression: "SET claimUntil = :until",
			ConditionExpression: "generation = :generation AND #page = :page AND #mode <> :complete AND (attribute_not_exists(claimUntil) OR claimUntil <= :now)",
			ExpressionAttributeNames: { "#page": "page", "#mode": "mode" },
			ExpressionAttributeValues: { ":generation": generation, ":page": page, ":complete": "complete", ":now": deps.now().getTime(), ":until": deps.now().getTime() + 120_000 },
		})),
		saveCheckpoint: async ({ previous, next }) => conditional(() => checkpoints.put({ Item: { ...next, key: "STATE" }, ...fence(previous) })),
		findObservation: async ({ userId, mailboxId, senderEmail }) => observations.get({ userId, key: `OBS#${mailboxId}#${senderEmail}` }, { consistentRead: true }),
		observeSender: async ({ checkpoint, observation, notify }) => {
			const previousNotice = notify ? await notices.get({ userId: checkpoint.userId, key: `NOTICE#${observation.email}` }, { consistentRead: true }) : undefined;
			const replacePending = previousNotice?.status === "pending" && (previousNotice.mailboxId !== checkpoint.mailboxId || previousNotice.accountEmail !== checkpoint.accountEmail || previousNotice.gatewayAddress !== checkpoint.gatewayAddress);
			const createNotice = notify && (previousNotice === undefined || previousNotice.status === "cancelled" || replacePending);
			return conditional(() => deps.client.send(new TransactWriteCommand({ TransactItems: [
				{ ConditionCheck: { TableName: deps.tableName, Key: { userId: checkpoint.userId, key: "STATE" }, ...fence(checkpoint) } },
				{ Put: { TableName: deps.tableName, Item: { userId: checkpoint.userId, key: `OBS#${checkpoint.mailboxId}#${observation.email}`, ...observation } } },
				...(createNotice ? [{ Put: {
					TableName: deps.tableName,
					Item: { userId: checkpoint.userId, key: `NOTICE#${observation.email}`, senderEmail: observation.email, accountEmail: checkpoint.accountEmail, gatewayAddress: checkpoint.gatewayAddress, mailboxId: checkpoint.mailboxId, status: "pending" },
					ConditionExpression: replacePending ? "#status = :pending AND mailboxId = :mailbox AND gatewayAddress = :gateway AND accountEmail = :account" : "attribute_not_exists(userId) OR #status = :cancelled",
					ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: replacePending ? { ":pending": "pending", ":mailbox": previousNotice.mailboxId, ":gateway": previousNotice.gatewayAddress, ":account": previousNotice.accountEmail } : { ":cancelled": "cancelled" },
				} }] : []),
			] })));
		},
		listObservations: async ({ userId, mailboxId, pageToken }) => {
			const page = await observations.query(query({ userId, prefix: `OBS#${mailboxId}#`, pageToken }));
			return { observations: page.items.map(({ email, name, approved, lastMessageAt }) => ({ email, name, approved, lastMessageAt })), nextPageToken: token(page.lastEvaluatedKey) };
		},
		listObservedSenders: async ({ userId, accountEmail }) => {
			const checkpoint = await checkpoints.get({ userId, key: "STATE" }, { consistentRead: true });
			if (checkpoint?.accountEmail.toLowerCase() !== accountEmail.toLowerCase()) return [];
			const senders: DiscoveredGmailSender[] = [];
			await forEachQueryPage(observations, query({ userId, prefix: `OBS#${checkpoint.mailboxId}#` }), async (rows) => {
				for (const { email, name } of rows) senders.push({ email, name });
			});
			return senders;
		},
		listNotices: async ({ userId, pageToken }) => {
			const page = await notices.query(query({ userId, prefix: "NOTICE#", pageToken }));
			return { notices: page.items, nextPageToken: token(page.lastEvaluatedKey) };
		},
		findNotice: async ({ userId, senderEmail }) => notices.get({ userId, key: `NOTICE#${senderEmail}` }, { consistentRead: true }),
		claimNotice: async ({ notice, message }) => {
			const acquired = await conditional(() => notices.update({
				Key: { userId: notice.userId, key: `NOTICE#${notice.senderEmail}` },
				UpdateExpression: "SET #status = :sending, #message = if_not_exists(#message, :message), firstAttemptAt = if_not_exists(firstAttemptAt, :now), claimUntil = :until",
				ConditionExpression: "mailboxId = :mailbox AND gatewayAddress = :gateway AND accountEmail = :account AND (#status = :pending OR #status = :sending) AND (attribute_not_exists(claimUntil) OR claimUntil <= :now)",
				ExpressionAttributeNames: { "#status": "status", "#message": "message" },
				ExpressionAttributeValues: { ":mailbox": notice.mailboxId, ":gateway": notice.gatewayAddress, ":account": notice.accountEmail, ":pending": "pending", ":sending": "sending", ":message": message, ":now": deps.now().getTime(), ":until": deps.now().getTime() + 120_000 },
			}));
			return acquired ? notices.get({ userId: notice.userId, key: `NOTICE#${notice.senderEmail}` }, { consistentRead: true }) : undefined;
		},
		markNoticeSent: async ({ userId, senderEmail }) => {
			await conditional(() => notices.update({
				Key: { userId, key: `NOTICE#${senderEmail}` }, UpdateExpression: "SET #status = :sent REMOVE claimUntil",
				ConditionExpression: "#status = :pending OR #status = :sending", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":pending": "pending", ":sending": "sending", ":sent": "sent" },
			}));
		},
		cancelNotice: async ({ userId, senderEmail }) => {
			await conditional(() => notices.update({ Key: { userId, key: `NOTICE#${senderEmail}` }, UpdateExpression: "SET #status = :cancelled", ConditionExpression: "#status = :pending", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":pending": "pending", ":cancelled": "cancelled" } }));
		},
		findNoticeBatch: async (userId) => NoticeBatch.optional().parse(await batches.get({ userId, key: NOTICE_BATCH_KEY }, { consistentRead: true })),
		claimNoticeBatch: async ({ userId, senders, message, lastSentBefore }) => {
			const acquired = await conditional(() => batches.update({
				Key: { userId, key: NOTICE_BATCH_KEY },
				UpdateExpression: "SET #status = :sending, senders = if_not_exists(senders, :senders), #message = if_not_exists(#message, :message), firstAttemptAt = if_not_exists(firstAttemptAt, :now), claimUntil = :until",
				ConditionExpression: "attribute_not_exists(userId) OR (#status = :idle AND lastSentAt <= :lastSentBefore) OR (#status = :sending AND claimUntil <= :now)",
				ExpressionAttributeNames: { "#status": "status", "#message": "message" },
				ExpressionAttributeValues: { ":idle": "idle", ":sending": "sending", ":senders": senders, ":message": message, ":lastSentBefore": lastSentBefore, ":now": deps.now().getTime(), ":until": deps.now().getTime() + 120_000 },
			}));
			return acquired ? ClaimedNoticeBatch.parse(await batches.get({ userId, key: NOTICE_BATCH_KEY }, { consistentRead: true })) : undefined;
		},
		finishNoticeBatch: async (userId) => {
			await conditional(() => batches.update({
				Key: { userId, key: NOTICE_BATCH_KEY },
				UpdateExpression: "SET #status = :idle, lastSentAt = :now REMOVE senders, #message, firstAttemptAt, claimUntil",
				ConditionExpression: "#status = :sending",
				ExpressionAttributeNames: { "#status": "status", "#message": "message" },
				ExpressionAttributeValues: { ":idle": "idle", ":sending": "sending", ":now": deps.now().getTime() },
			}));
		},
		deleteAllByUserId: async (userId) => {
			await forEachQueryPage(keys, { KeyConditionExpression: "userId = :uid", ExpressionAttributeValues: { ":uid": userId }, ConsistentRead: true }, async (rows) => {
				await Promise.all(rows.map((row) => keys.delete({ Key: row })));
			});
		},
	};
}
