import assert from "node:assert/strict";
import { z } from "zod";
import { ForwardableSenderSchema, GmailAccountEmailSchema } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { ConditionalCheckFailedException, TransactionCanceledException, createDynamoDocumentClient } from "@packages/hutch-storage-client";
import type { EmailMessage } from "@packages/provider-contracts/email";
import type { GmailMonitoringCheckpoint, GmailNewsletterNotice } from "@packages/provider-contracts/gmail-monitoring";
import { initDynamoDbGmailMonitoring } from "./dynamodb-gmail-monitoring";

const USER = UserIdSchema.parse("reader-1");
const SENDER = ForwardableSenderSchema.parse("weekly@news.example");
const ACCOUNT = GmailAccountEmailSchema.parse("reader@gmail.com");
const GATEWAY = InboxAddressSchema.parse("gmail-abc123@read.place");
const NOW = new Date("2026-10-04T00:00:00.000Z");
const TABLE = "gmail-monitoring-test";
const CHECKPOINT: GmailMonitoringCheckpoint = {
	userId: USER, generation: "run-1", page: 2, mailboxId: "mailbox-1", accountEmail: ACCOUNT,
	gatewayAddress: GATEWAY, mode: "arrivals", initializing: false, historyId: "123",
	pageToken: undefined, scannedCount: 25, lastCheckedAt: NOW.getTime(),
};
const MESSAGE: EmailMessage = { from: "Readplace <hello@readplace.com>", to: "reader@example.com", subject: "Choose a readlist", html: "<p>Newsletter</p>", idempotencyKey: "newsletter/key-1" };
const NOTICE: GmailNewsletterNotice = {
	userId: USER, senderEmail: SENDER, accountEmail: ACCOUNT, gatewayAddress: GATEWAY,
	mailboxId: CHECKPOINT.mailboxId, status: "pending", message: undefined,
	firstAttemptAt: undefined, claimUntil: undefined,
};

function harness(replies: unknown[] = []) {
	const commands: Record<string, unknown>[] = [];
	const client = Object.assign(createDynamoDocumentClient({ region: "ap-southeast-2" }), {
		send: async (command: unknown) => {
			commands.push(z.object({ input: z.record(z.string(), z.unknown()) }).parse(command).input);
			const reply = replies.shift();
			if (reply instanceof Error) throw reply;
			return reply ?? {};
		},
	});
	return { commands, store: initDynamoDbGmailMonitoring({ client, tableName: TABLE, now: () => NOW }) };
}

function conditionFailure() {
	return new ConditionalCheckFailedException({ $metadata: {}, message: "condition no longer holds" });
}

describe("initDynamoDbGmailMonitoring", () => {
	it("reads checkpoints, observations and notification receipts strongly by their exact keys", async () => {
		const observed = { userId: USER, key: `OBS#mailbox-1#${SENDER}`, email: SENDER, name: "Weekly", approved: false, lastMessageAt: NOW.getTime() };
		const h = harness([
			{ Item: { ...CHECKPOINT, key: "STATE", pageToken: null } },
			{ Item: observed },
			{ Item: { ...NOTICE, key: `NOTICE#${SENDER}` } },
			{}, {}, {},
		]);
		const checkpoint = await h.store.findCheckpoint(USER);
		assert.equal(checkpoint?.historyId, "123");
		assert.equal(checkpoint?.pageToken, undefined);
		assert.equal((await h.store.findObservation({ userId: USER, mailboxId: "mailbox-1", senderEmail: SENDER }))?.approved, false);
		assert.equal((await h.store.findNotice({ userId: USER, senderEmail: SENDER }))?.status, "pending");
		assert.equal(await h.store.findCheckpoint(USER), undefined);
		assert.equal(await h.store.findObservation({ userId: USER, mailboxId: "mailbox-1", senderEmail: SENDER }), undefined);
		assert.equal(await h.store.findNotice({ userId: USER, senderEmail: SENDER }), undefined);
		assert.deepEqual(h.commands.slice(0, 3), [
			{ TableName: TABLE, Key: { userId: USER, key: "STATE" }, ConsistentRead: true },
			{ TableName: TABLE, Key: { userId: USER, key: `OBS#mailbox-1#${SENDER}` }, ConsistentRead: true },
			{ TableName: TABLE, Key: { userId: USER, key: `NOTICE#${SENDER}` }, ConsistentRead: true },
		]);
	});

	it("starts only an absent state and fences replacement runs and page completion on the old generation and page", async () => {
		const h = harness();
		assert.equal(await h.store.startRun({ checkpoint: CHECKPOINT, previous: undefined }), true);
		assert.equal(await h.store.startRun({ checkpoint: { ...CHECKPOINT, generation: "run-2", page: 0 }, previous: CHECKPOINT }), true);
		assert.equal(await h.store.saveCheckpoint({ previous: CHECKPOINT, next: { ...CHECKPOINT, page: 3, mode: "reconcile" } }), true);
		assert.equal(h.commands[0].ConditionExpression, "attribute_not_exists(userId)");
		for (const command of h.commands.slice(1)) {
			assert.match(String(command.ConditionExpression), /generation = :generation AND #page = :page/);
			assert.deepEqual(command.ExpressionAttributeValues, { ":generation": "run-1", ":page": 2 });
		}
		expect(h.commands[2].Item).toMatchObject({ key: "STATE", page: 3, mode: "reconcile" });
	});

	it("claims a nonterminal matching page only when its two-minute lease has expired", async () => {
		const h = harness();
		assert.equal(await h.store.claimPage({ userId: USER, generation: "run-1", page: 2 }), true);
		assert.match(String(h.commands[0].ConditionExpression), /generation = :generation AND #page = :page/);
		assert.match(String(h.commands[0].ConditionExpression), /#mode <> :complete/);
		assert.match(String(h.commands[0].ConditionExpression), /attribute_not_exists\(claimUntil\) OR claimUntil <= :now/);
		assert.deepEqual(h.commands[0].ExpressionAttributeValues, {
			":generation": "run-1", ":page": 2, ":complete": "complete", ":now": NOW.getTime(), ":until": NOW.getTime() + 120_000,
		});
	});

	it("returns false for conditional contention and propagates storage and unrelated transaction errors", async () => {
		const page = { userId: USER, generation: "run-1", page: 2 };
		assert.equal(await harness([conditionFailure()]).store.claimPage(page), false);
		const transactionRace = new TransactionCanceledException({ $metadata: {}, message: "page raced", CancellationReasons: [{ Code: "ConditionalCheckFailed" }] });
		assert.equal(await harness([transactionRace]).store.startRun({ checkpoint: CHECKPOINT, previous: CHECKPOINT }), false);
		await assert.rejects(harness([new Error("datastore unavailable")]).store.claimPage(page), /datastore unavailable/);
		const transactionFailure = new TransactionCanceledException({ $metadata: {}, message: "throttled", CancellationReasons: [{ Code: "ThrottlingError" }] });
		await assert.rejects(harness([transactionFailure]).store.claimPage(page), /throttled/);
		const transactionWithoutReasons = new TransactionCanceledException({ $metadata: {}, message: "transaction unavailable" });
		await assert.rejects(harness([transactionWithoutReasons]).store.claimPage(page), /transaction unavailable/);
	});

	it("records a silent baseline observation in the same transaction as the checkpoint fence", async () => {
		const h = harness();
		const observation = { email: SENDER, name: undefined, approved: true };
		assert.equal(await h.store.observeSender({ checkpoint: CHECKPOINT, observation, notify: false }), true);
		assert.equal(h.commands.length, 1);
		assert.deepEqual(h.commands[0].TransactItems, [
			{ ConditionCheck: { TableName: TABLE, Key: { userId: USER, key: "STATE" }, ConditionExpression: "generation = :generation AND #page = :page", ExpressionAttributeNames: { "#page": "page" }, ExpressionAttributeValues: { ":generation": "run-1", ":page": 2 } } },
			{ Put: { TableName: TABLE, Item: { userId: USER, key: `OBS#mailbox-1#${SENDER}`, ...observation } } },
		]);
	});

	it.each([undefined, "cancelled"])("atomically queues a notice only when its receipt is %s", async (status) => {
		const previous = status === undefined ? {} : { Item: { ...NOTICE, key: `NOTICE#${SENDER}`, status } };
		const h = harness([previous]);
		assert.equal(await h.store.observeSender({ checkpoint: CHECKPOINT, observation: { email: SENDER, name: "Weekly", approved: true }, notify: true }), true);
		assert.equal(h.commands[0].ConsistentRead, true);
		const transaction = z.array(z.object({ ConditionCheck: z.unknown().optional(), Put: z.record(z.string(), z.unknown()).optional() })).parse(h.commands[1].TransactItems);
		assert.equal(transaction.length, 3);
		expect(transaction[2].Put).toMatchObject({
			Item: { userId: USER, key: `NOTICE#${SENDER}`, senderEmail: SENDER, mailboxId: "mailbox-1", accountEmail: ACCOUNT, gatewayAddress: GATEWAY, status: "pending" },
			ConditionExpression: "attribute_not_exists(userId) OR #status = :cancelled",
			ExpressionAttributeValues: { ":cancelled": "cancelled" },
		});
	});

	it.each(["pending", "sending", "sent"])("preserves a %s notice when the sender qualifies again", async (status) => {
		const h = harness([{ Item: { ...NOTICE, key: `NOTICE#${SENDER}`, status } }]);
		assert.equal(await h.store.observeSender({ checkpoint: CHECKPOINT, observation: { email: SENDER, name: "Renamed", approved: true }, notify: true }), true);
		assert.equal(z.array(z.unknown()).parse(h.commands[1].TransactItems).length, 2);
	});

	it.each([
		{ mailboxId: "mailbox-2" },
		{ gatewayAddress: InboxAddressSchema.parse("gmail-new123@read.place") },
		{ accountEmail: GmailAccountEmailSchema.parse("other@gmail.com") },
	])("atomically replaces an eligible stale pending notice for a changed connection: %p", async (changed) => {
		const h = harness([{ Item: { ...NOTICE, key: `NOTICE#${SENDER}` } }]);
		const checkpoint = { ...CHECKPOINT, ...changed, generation: "run-2" };
		assert.equal(await h.store.observeSender({ checkpoint, observation: { email: SENDER, name: undefined, approved: true }, notify: true }), true);
		const transaction = z.array(z.object({ Put: z.record(z.string(), z.unknown()).optional() })).parse(h.commands[1].TransactItems);
		assert.equal(transaction.length, 3);
		const noticeWrite = transaction[2].Put;
		assert(noticeWrite);
		expect(noticeWrite.Item).toMatchObject({ mailboxId: checkpoint.mailboxId, accountEmail: checkpoint.accountEmail, gatewayAddress: checkpoint.gatewayAddress, status: "pending" });
		assert.match(String(noticeWrite.ConditionExpression), /#status = :pending/);
		assert.match(String(noticeWrite.ConditionExpression), /mailboxId/);
		assert.match(String(noticeWrite.ConditionExpression), /accountEmail/);
		assert.match(String(noticeWrite.ConditionExpression), /gatewayAddress/);
		const values = z.record(z.string(), z.unknown()).parse(noticeWrite.ExpressionAttributeValues);
		assert(Object.values(values).includes(NOTICE.mailboxId));
		assert(Object.values(values).includes(NOTICE.accountEmail));
		assert(Object.values(values).includes(NOTICE.gatewayAddress));
		const raced = harness([{ Item: { ...NOTICE, key: `NOTICE#${SENDER}` } }, conditionFailure()]);
		assert.equal(await raced.store.observeSender({ checkpoint, observation: { email: SENDER, name: undefined, approved: true }, notify: true }), false);
	});

	it.each(["sending", "sent"])("preserves an old-connection %s receipt when a replacement mailbox qualifies", async (status) => {
		const h = harness([{ Item: { ...NOTICE, key: `NOTICE#${SENDER}`, status, message: MESSAGE, firstAttemptAt: NOW.getTime() } }]);
		const checkpoint = { ...CHECKPOINT, mailboxId: "mailbox-2", accountEmail: GmailAccountEmailSchema.parse("other@gmail.com"), gatewayAddress: InboxAddressSchema.parse("gmail-new123@read.place") };
		assert.equal(await h.store.observeSender({ checkpoint, observation: { email: SENDER, name: undefined, approved: true }, notify: true }), true);
		assert.equal(z.array(z.unknown()).parse(h.commands[1].TransactItems).length, 2);
	});

	it("pages mailbox observations with a bounded strongly consistent query and opaque cursor", async () => {
		const lastKey = { userId: USER, key: `OBS#mailbox-1#${SENDER}` };
		const observation = { email: SENDER, name: "Weekly", approved: true, lastMessageAt: NOW.getTime() };
		const h = harness([{ Items: [{ ...lastKey, ...observation }], LastEvaluatedKey: lastKey }, { Items: [] }]);
		const first = await h.store.listObservations({ userId: USER, mailboxId: "mailbox-1" });
		assert.deepEqual(first.observations, [observation]);
		assert(first.nextPageToken);
		assert.deepEqual(JSON.parse(Buffer.from(first.nextPageToken, "base64url").toString()), lastKey);
		assert.deepEqual(await h.store.listObservations({ userId: USER, mailboxId: "mailbox-1", pageToken: first.nextPageToken }), { observations: [], nextPageToken: undefined });
		expect(h.commands[0]).toMatchObject({ ConsistentRead: true, Limit: 25, ExpressionAttributeValues: { ":uid": USER, ":prefix": "OBS#mailbox-1#" } });
		assert.deepEqual(h.commands[1].ExclusiveStartKey, lastKey);
	});

	it("pages user-scoped notice rows while keeping their stable payload and receipt state", async () => {
		const key = { userId: USER, key: `NOTICE#${SENDER}` };
		const persisted = { ...NOTICE, ...key, status: "sent", message: MESSAGE, firstAttemptAt: NOW.getTime() };
		const h = harness([{ Items: [persisted], LastEvaluatedKey: key }, { Items: [] }]);
		const first = await h.store.listNotices({ userId: USER });
		assert.deepEqual(first.notices, [persisted]);
		assert(first.nextPageToken);
		assert.deepEqual(await h.store.listNotices({ userId: USER, pageToken: first.nextPageToken }), { notices: [], nextPageToken: undefined });
		expect(h.commands[0]).toMatchObject({ ConsistentRead: true, Limit: 25, ExpressionAttributeValues: { ":uid": USER, ":prefix": "NOTICE#" } });
		assert.deepEqual(h.commands[1].ExclusiveStartKey, key);
	});

	it("rejects a malformed continuation before issuing the mailbox query", async () => {
		const h = harness();
		await assert.rejects(h.store.listObservations({ userId: USER, mailboxId: "mailbox-1", pageToken: Buffer.from("invalid json").toString("base64url") }));
		assert.deepEqual(h.commands, []);
	});

	it("offers observed senders only for the checkpoint's mailbox and reads all observation pages", async () => {
		const nextKey = { userId: USER, key: `OBS#mailbox-1#${SENDER}` };
		const other = ForwardableSenderSchema.parse("another@news.example");
		const h = harness([
			{ Item: { ...CHECKPOINT, key: "STATE" } },
			{ Items: [{ ...nextKey, email: SENDER, name: "Weekly", approved: true }], LastEvaluatedKey: nextKey },
			{ Items: [{ userId: USER, key: `OBS#mailbox-1#${other}`, email: other, name: null, approved: false }] },
		]);
		assert.deepEqual(await h.store.listObservedSenders({ userId: USER, accountEmail: ACCOUNT }), [{ email: SENDER, name: "Weekly" }, { email: other, name: undefined }]);
		assert.deepEqual(h.commands[2].ExclusiveStartKey, nextKey);
		assert.deepEqual(await harness([{}]).store.listObservedSenders({ userId: USER, accountEmail: ACCOUNT }), []);
		const changed = harness([{ Item: { ...CHECKPOINT, key: "STATE" } }]);
		assert.deepEqual(await changed.store.listObservedSenders({ userId: USER, accountEmail: GmailAccountEmailSchema.parse("other@gmail.com") }), []);
		assert.equal(changed.commands.length, 1);
	});

	it("claims pending or sending notices by mailbox and preserves the original retry payload and first attempt", async () => {
		const original = { ...NOTICE, key: `NOTICE#${SENDER}`, status: "sending", message: MESSAGE, firstAttemptAt: NOW.getTime() - 60_000, claimUntil: NOW.getTime() + 120_000 };
		const replacement = { ...MESSAGE, subject: "Changed catalog name" };
		const h = harness([{}, { Item: original }]);
		assert.deepEqual(await h.store.claimNotice({ notice: NOTICE, message: replacement }), original);
		assert.match(String(h.commands[0].ConditionExpression), /mailboxId = :mailbox/);
		assert.match(String(h.commands[0].ConditionExpression), /gatewayAddress/);
		assert.match(String(h.commands[0].ConditionExpression), /accountEmail/);
		assert.match(String(h.commands[0].ConditionExpression), /#status = :pending OR #status = :sending/);
		assert.match(String(h.commands[0].ConditionExpression), /claimUntil <= :now/);
		assert.match(String(h.commands[0].UpdateExpression), /#message = if_not_exists\(#message, :message\)/);
		assert.match(String(h.commands[0].UpdateExpression), /firstAttemptAt = if_not_exists\(firstAttemptAt, :now\)/);
		expect(h.commands[0].ExpressionAttributeValues).toMatchObject({ ":mailbox": "mailbox-1", ":message": replacement, ":now": NOW.getTime(), ":until": NOW.getTime() + 120_000 });
		assert.equal(h.commands[1].ConsistentRead, true);
		const raced = harness([conditionFailure()]);
		assert.equal(await raced.store.claimNotice({ notice: NOTICE, message: MESSAGE }), undefined);
		assert.equal(raced.commands.length, 1);
		assert.equal(await harness([{}, {}]).store.claimNotice({ notice: NOTICE, message: MESSAGE }), undefined);
	});

	it("marks only sending notices as sent, and cancels only pending notices", async () => {
		const h = harness([{}, {}, conditionFailure(), conditionFailure()]);
		await h.store.markNoticeSent({ userId: USER, senderEmail: SENDER });
		await h.store.cancelNotice({ userId: USER, senderEmail: SENDER });
		await h.store.markNoticeSent({ userId: USER, senderEmail: SENDER });
		await h.store.cancelNotice({ userId: USER, senderEmail: SENDER });
		assert.match(String(h.commands[0].ConditionExpression), /#status = :sending/);
		assert.match(String(h.commands[0].UpdateExpression), /REMOVE claimUntil/);
		assert.deepEqual(h.commands[0].ExpressionAttributeValues, { ":sending": "sending", ":sent": "sent" });
		assert.match(String(h.commands[1].ConditionExpression), /#status = :pending/);
		assert.deepEqual(h.commands[1].ExpressionAttributeValues, { ":pending": "pending", ":cancelled": "cancelled" });
	});

	it("erases all user state, mailbox observations and permanent receipts through paginated Query and Delete", async () => {
		const checkpointKey = { userId: USER, key: "STATE" };
		const observationKey = { userId: USER, key: `OBS#old-mailbox#${SENDER}` };
		const receiptKey = { userId: USER, key: `NOTICE#${SENDER}` };
		const h = harness([{ Items: [checkpointKey, observationKey], LastEvaluatedKey: observationKey }, {}, {}, { Items: [receiptKey] }, {}]);
		await h.store.deleteAllByUserId(USER);
		assert.deepEqual(h.commands.map((command) => command.Key).filter((key) => key !== undefined), [checkpointKey, observationKey, receiptKey]);
		expect(h.commands[0]).toMatchObject({ KeyConditionExpression: "userId = :uid", ExpressionAttributeValues: { ":uid": USER }, ConsistentRead: true });
		assert.deepEqual(h.commands[3].ExclusiveStartKey, observationKey);
		const empty = harness([{ Items: [] }]);
		await empty.store.deleteAllByUserId(USER);
		assert.equal(empty.commands.length, 1);
	});
});
