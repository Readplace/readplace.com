import assert from "node:assert/strict";
import { ConditionalCheckFailedException, TransactionCanceledException, type DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { ForwardableSenderSchema, GmailAccountEmailSchema, type GmailDiscovery } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { initDynamoDbGmailDiscovery } from "./dynamodb-gmail-discovery";

const USER = UserIdSchema.parse("user-1");
const NOW = new Date("2026-09-12T00:00:00.000Z");
const STATE: GmailDiscovery = {
	userId: USER,
	accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com"),
	gatewayAddress: InboxAddressSchema.parse("gmail-a7b2c9@read.place"),
	generation: "run-1", state: "running", mode: "full", page: 0, pageToken: undefined, historyId: "100", scannedCount: 0, checkedMessageCount: 40, estimatedTotalMessages: 250, oldestScannedAt: undefined, updatedAt: NOW.toISOString(), error: undefined,
};
const SENDER = { email: ForwardableSenderSchema.parse("sender@example.com"), name: "Sender" };
interface Command {
	input: {
		Item?: Record<string, unknown>;
		Key?: Record<string, unknown>;
		ConsistentRead?: boolean;
		Limit?: number;
		ExclusiveStartKey?: Record<string, unknown>;
		UpdateExpression?: string;
		ConditionExpression?: string;
		KeyConditionExpression?: string;
		ExpressionAttributeValues?: Record<string, unknown>;
		TransactItems?: {
			Put?: { Item: Record<string, unknown>; ConditionExpression?: string };
			Update?: { Key: Record<string, unknown>; UpdateExpression: string; ExpressionAttributeNames?: Record<string, unknown>; ExpressionAttributeValues?: Record<string, unknown> };
		}[];
	};
}

function harness(reply: (command: Command) => unknown = () => ({})) {
	const commands: Command[] = [];
	const client: Partial<DynamoDBDocumentClient> = {
		send: (async (command: Command) => { commands.push(command); return reply(command); }) as DynamoDBDocumentClient["send"],
	};
	return { commands, store: initDynamoDbGmailDiscovery({ client: client as DynamoDBDocumentClient, tableName: "discovery", now: () => NOW }) };
}

describe("initDynamoDbGmailDiscovery", () => {
	it("returns one bounded sender page and resumes strongly by its user-scoped key cursor", async () => {
		const senders = Array.from({ length: 25 }, (_, index) => ({ email: ForwardableSenderSchema.parse(`sender-${String(index).padStart(2, "0")}@example.com`), name: `Sender ${index}` }));
		const nextSender = { email: ForwardableSenderSchema.parse("sender-25@example.com"), name: undefined };
		const lastKey = { userId: USER, recordKey: `SENDER#${senders[24].email}` };
		let reads = 0;
		const h = harness(() => {
			reads += 1;
			return reads === 1
				? { Items: senders.map((sender) => ({ userId: USER, recordKey: `SENDER#${sender.email}`, ...sender })), LastEvaluatedKey: lastKey }
				: { Items: [{ userId: USER, recordKey: `SENDER#${nextSender.email}`, ...nextSender }] };
		});
		const first = await h.store.listSendersPage({ userId: USER });
		assert.deepEqual(first.senders, senders);
		assert.equal(reads, 1);
		assert(first.nextPageToken);
		assert.deepEqual(JSON.parse(Buffer.from(first.nextPageToken, "base64url").toString()), lastKey);
		assert.deepEqual(await h.store.listSendersPage({ userId: USER, pageToken: first.nextPageToken }), { senders: [nextSender], nextPageToken: undefined });
		for (const command of h.commands) {
			assert.equal(command.input.Limit, 25);
			assert.equal(command.input.ConsistentRead, true);
			assert.equal(command.input.KeyConditionExpression, "userId = :uid AND begins_with(recordKey, :prefix)");
			assert.deepEqual(command.input.ExpressionAttributeValues, { ":uid": USER, ":prefix": "SENDER#" });
		}
		assert.equal(h.commands[0].input.ExclusiveStartKey, undefined);
		assert.deepEqual(h.commands[1].input.ExclusiveStartKey, lastKey);
	});

	it("keeps empty sender pages scoped to the requested user and rejects another user's or malformed cursor", async () => {
		const otherUser = UserIdSchema.parse("other-user");
		const h = harness();
		assert.deepEqual(await h.store.listSendersPage({ userId: otherUser }), { senders: [], nextPageToken: undefined });
		assert.deepEqual(h.commands[0].input.ExpressionAttributeValues, { ":uid": otherUser, ":prefix": "SENDER#" });
		const otherCursor = Buffer.from(JSON.stringify({ userId: otherUser, recordKey: `SENDER#${SENDER.email}` })).toString("base64url");
		await assert.rejects(h.store.listSendersPage({ userId: USER, pageToken: otherCursor }), /cursor must belong/);
		await assert.rejects(h.store.listSendersPage({ userId: USER, pageToken: Buffer.from("invalid JSON").toString("base64url") }));
		assert.equal(h.commands.length, 1);
	});

	it("reads strongly consistent checkpoints and every cached sender page", async () => {
		let page = 0;
		const { estimatedTotalMessages: _estimatedTotalMessages, ...legacyState } = STATE;
		const { store, commands } = harness((command) => {
			if (command.input.Key) return { Item: { ...legacyState, recordKey: "STATE", claimUntil: 123 } };
			page += 1;
			return { Items: [{ userId: USER, recordKey: `SENDER#${SENDER.email}`, ...SENDER }], ...(page === 1 ? { LastEvaluatedKey: { userId: USER, recordKey: "SENDER#first" } } : {}) };
		});
		const found = await store.findDiscoveryByUserId(USER);
		assert(found);
		assert.equal(found.estimatedTotalMessages, undefined);
		assert.deepEqual(found, { ...legacyState, requiresReconnect: false });
		assert.equal(commands[0].input.ConsistentRead, true);
		assert.deepEqual(await store.listSendersByUserId(USER), [SENDER, SENDER]);
		assert.equal(page, 2);
		assert.match(String(commands[1].input.KeyConditionExpression), /begins_with/);
		assert.equal(commands[1].input.ConsistentRead, true);
		assert.equal(await harness().store.findDiscoveryByUserId(USER), undefined);
	});

	it("starts and claims with conditional writes, then commits sender rows with the checkpoint", async () => {
		const { store, commands } = harness();
		assert.equal(await store.startDiscovery({ ...STATE }), true);
		assert.match(String(commands[0].input.ConditionExpression), /attribute_not_exists/);
		assert.equal(await store.claimPage({ userId: USER, generation: "run-1", page: 0 }), true);
		assert.match(String(commands[1].input.ConditionExpression), /claimUntil/);
		assert.equal(commands[1].input.ExpressionAttributeValues?.[":until"], NOW.getTime() + 60_000);
		assert.equal(await store.savePage({ previous: STATE, senders: [SENDER, SENDER], mode: "full", pageToken: "next", historyId: "102", state: "running", scannedMessages: 25, estimatedTotalMessages: 250, oldestScannedAt: 1_700_000_000_000 }), true);
		const writes = commands[2].input.TransactItems;
		assert(writes);
		assert.equal(writes.length, 2);
		assert(writes[0].Put);
		assert.equal(writes[0].Put.Item.page, 1);
		assert.equal(writes[0].Put.Item.scannedCount, 25);
		assert.equal(writes[0].Put.Item.estimatedTotalMessages, 250);
		assert.equal(writes[0].Put.Item.oldestScannedAt, 1_700_000_000_000);
		assert.match(String(writes[0].Put.ConditionExpression), /generation = :generation/);
		assert(writes[1].Update);
		assert.deepEqual(writes[1].Update.Key, { userId: USER, recordKey: `SENDER#${SENDER.email}` });
		assert.match(writes[1].Update.UpdateExpression, /#name = :name/);
		assert.deepEqual(writes[1].Update.ExpressionAttributeNames, { "#name": "name" });
		assert.equal(writes[1].Update.ExpressionAttributeValues?.[":name"], "Sender");
		await store.failDiscovery({ userId: USER, generation: "run-1", error: "Try again", requiresReconnect: true });
		assert.equal(commands[3].input.ExpressionAttributeValues?.[":error"], "Try again");
		assert.equal(commands[3].input.ExpressionAttributeValues?.[":requiresReconnect"], true);
		await store.clearRequiresReconnect({ userId: USER, generation: "reconnected" });
		assert.match(String(commands[4].input.ConditionExpression), /attribute_exists/);
		assert.match(String(commands[4].input.UpdateExpression), /generation = :generation/);
		assert.match(String(commands[4].input.UpdateExpression), /REMOVE claimUntil/);
		assert.equal(commands[4].input.ExpressionAttributeValues?.[":off"], false);
		assert.equal(commands[4].input.ExpressionAttributeValues?.[":generation"], "reconnected");
		await store.startDiscovery({ ...STATE, resume: { page: 4, pageToken: "resume", scannedCount: 100, estimatedTotalMessages: 500, oldestScannedAt: 1_700_000_000_000 } });
		assert.equal(commands[5].input.Item?.page, 4);
		assert.equal(commands[5].input.Item?.pageToken, "resume");
		assert.equal(commands[5].input.Item?.scannedCount, 100);
		assert.equal(commands[5].input.Item?.estimatedTotalMessages, 500);
		assert.equal(commands[5].input.Item?.oldestScannedAt, 1_700_000_000_000);
	});

	it("leaves a stored display name alone when a page carries the sender without one", async () => {
		const { store, commands } = harness();
		assert.equal(await store.savePage({ previous: STATE, senders: [{ email: SENDER.email, name: undefined }], mode: "full", pageToken: "next", historyId: "102", state: "running", scannedMessages: 25, estimatedTotalMessages: 250, oldestScannedAt: undefined }), true);
		const writes = commands[0].input.TransactItems;
		assert(writes);
		assert(writes[1].Update);
		assert.equal(writes[1].Update.UpdateExpression, "SET email = :email");
		assert.deepEqual(writes[1].Update.ExpressionAttributeValues, { ":email": SENDER.email });
	});

	it("reads a checkpoint stored before the checked-message counter existed as having checked none", async () => {
		const { checkedMessageCount: _checkedMessageCount, ...storedBeforeCounter } = STATE;
		const { store } = harness(() => ({ Item: { ...storedBeforeCounter, recordKey: "STATE" } }));
		const found = await store.findDiscoveryByUserId(USER);
		assert(found);
		assert.equal(found.checkedMessageCount, 0);
	});

	it("stores the carried checked-message count when a discovery starts", async () => {
		const { store, commands } = harness();
		await store.startDiscovery({ userId: USER, accountEmail: STATE.accountEmail, gatewayAddress: STATE.gatewayAddress, generation: "run-2", mode: "profile", historyId: undefined, checkedMessageCount: 140 });
		assert.equal(commands[0].input.Item?.checkedMessageCount, 140);
	});

	it("adds every page's scanned messages to the lifetime checked count, including a profile reset", async () => {
		const { store, commands } = harness();
		await store.savePage({ previous: STATE, senders: [], mode: "full", pageToken: "next", historyId: "102", state: "running", scannedMessages: 25, estimatedTotalMessages: 250, oldestScannedAt: undefined });
		await store.savePage({ previous: { ...STATE, scannedCount: 75 }, senders: [], mode: "profile", pageToken: undefined, historyId: undefined, state: "running", scannedMessages: 3, estimatedTotalMessages: undefined, oldestScannedAt: undefined });
		assert.equal(commands[0].input.TransactItems?.[0].Put?.Item.checkedMessageCount, 65);
		assert.equal(commands[1].input.TransactItems?.[0].Put?.Item.checkedMessageCount, 43);
	});

	it("resets accumulated scan progress when a new full pass is required", async () => {
		const { store, commands } = harness();
		assert.equal(await store.savePage({ previous: { ...STATE, scannedCount: 75 }, senders: [], mode: "profile", pageToken: undefined, historyId: undefined, state: "running", scannedMessages: 0, estimatedTotalMessages: undefined, oldestScannedAt: undefined }), true);
		const checkpoint = commands[0].input.TransactItems?.[0];
		assert(checkpoint?.Put);
		assert.equal(checkpoint.Put.Item.scannedCount, 0);
	});

	it("treats conditional races as no-ops and propagates storage failures", async () => {
		const conflict = new ConditionalCheckFailedException({ $metadata: {}, message: "race" });
		const denied = harness(() => { throw conflict; }).store;
		assert.equal(await denied.startDiscovery(STATE), false);
		assert.equal(await denied.claimPage({ userId: USER, generation: "run-1", page: 0 }), false);
		await denied.failDiscovery({ userId: USER, generation: "run-1", error: "late" });
		await denied.clearRequiresReconnect({ userId: USER, generation: "reconnected" });
		const page = { previous: STATE, senders: [SENDER], mode: "history", pageToken: undefined, historyId: "102", state: "complete", scannedMessages: 25, estimatedTotalMessages: undefined, oldestScannedAt: undefined } as const;
		const cancelled = new TransactionCanceledException({ $metadata: {}, message: "race", CancellationReasons: [{ Code: "ConditionalCheckFailed" }] });
		assert.equal(await harness(() => { throw cancelled; }).store.savePage(page), false);
		for (const failure of [new Error("offline"), new TransactionCanceledException({ $metadata: {}, message: "unknown" }), new TransactionCanceledException({ $metadata: {}, message: "capacity", CancellationReasons: [{ Code: "ProvisionedThroughputExceeded" }] })]) {
			await assert.rejects(harness(() => { throw failure; }).store.savePage(page), (error: unknown) => error === failure);
		}
	});

	it("deletes the checkpoint before sender rows so in-flight page transactions cannot recreate them", async () => {
		const { store, commands } = harness((command) => command.input.Key ? {} : { Items: [{ userId: USER, recordKey: `SENDER#${SENDER.email}`, ...SENDER }] });
		await store.deleteDiscoveryByUserId(USER);
		assert.deepEqual(commands[0].input.Key, { userId: USER, recordKey: "STATE" });
		assert.deepEqual(commands[2].input.Key, { userId: USER, recordKey: `SENDER#${SENDER.email}` });
		await harness().store.deleteDiscoveryByUserId(USER);
	});

	it("fences multi-author pages in bounded transactions and advances the checkpoint only after all senders are saved", async () => {
		const senders = Array.from({ length: 101 }, (_, index) => ({ email: ForwardableSenderSchema.parse(`author${index}@example.com`), name: undefined }));
		const page = { previous: STATE, senders, mode: "history", pageToken: undefined, historyId: "102", state: "complete", scannedMessages: 25, estimatedTotalMessages: undefined, oldestScannedAt: undefined } as const;
		const { store, commands } = harness();
		assert.equal(await store.savePage(page), true);
		assert.equal(commands.length, 2);
		assert.equal(commands[0].input.TransactItems?.length, 100);
		assert.match(JSON.stringify(commands[0].input.TransactItems?.[0]), /ConditionCheck/);
		assert.equal(commands[0].input.TransactItems?.[1].Update?.UpdateExpression, "SET email = :email");
		assert.equal(commands[1].input.TransactItems?.length, 3);
		const finalCheckpoint = commands[1].input.TransactItems?.[0];
		assert(finalCheckpoint?.Put);
		assert.equal(finalCheckpoint.Put.Item.recordKey, "STATE");
		const cancelled = harness(() => { throw new ConditionalCheckFailedException({ $metadata: {}, message: "deleted" }); });
		assert.equal(await cancelled.store.savePage(page), false);
		assert.equal(cancelled.commands.length, 1);
	});
});
