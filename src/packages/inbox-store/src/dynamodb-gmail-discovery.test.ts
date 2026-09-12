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
	generation: "run-1", state: "running", mode: "full", page: 0, pageToken: undefined, historyId: "100", scannedCount: 0, updatedAt: NOW.toISOString(), error: undefined,
};
const SENDER = { email: ForwardableSenderSchema.parse("sender@example.com"), name: "Sender" };
interface Command {
	input: {
		Item?: Record<string, unknown>;
		Key?: Record<string, unknown>;
		ConsistentRead?: boolean;
		ConditionExpression?: string;
		KeyConditionExpression?: string;
		ExpressionAttributeValues?: Record<string, unknown>;
		TransactItems?: { Put: { Item: Record<string, unknown>; ConditionExpression?: string } }[];
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
	it("reads strongly consistent checkpoints and every cached sender page", async () => {
		let page = 0;
		const { store, commands } = harness((command) => {
			if (command.input.Key) return { Item: { ...STATE, recordKey: "STATE", claimUntil: 123 } };
			page += 1;
			return { Items: [{ userId: USER, recordKey: `SENDER#${SENDER.email}`, ...SENDER }], ...(page === 1 ? { LastEvaluatedKey: { userId: USER, recordKey: "SENDER#first" } } : {}) };
		});
		assert.deepEqual(await store.findDiscoveryByUserId(USER), { ...STATE, requiresReconnect: false });
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
		assert.equal(await store.savePage({ previous: STATE, senders: [SENDER, SENDER], mode: "history", pageToken: undefined, historyId: "102", state: "complete", scannedMessages: 25 }), true);
		const writes = commands[2].input.TransactItems;
		assert(writes);
		assert.equal(writes.length, 2);
		assert.equal(writes[0].Put.Item.page, 1);
		assert.equal(writes[0].Put.Item.scannedCount, 25);
		assert.match(String(writes[0].Put.ConditionExpression), /generation = :generation/);
		assert.equal(writes[1].Put.Item.email, SENDER.email);
		await store.failDiscovery({ userId: USER, generation: "run-1", error: "Try again", requiresReconnect: true });
		assert.equal(commands[3].input.ExpressionAttributeValues?.[":error"], "Try again");
		assert.equal(commands[3].input.ExpressionAttributeValues?.[":requiresReconnect"], true);
		await store.startDiscovery({ ...STATE, resume: { page: 4, pageToken: "resume", scannedCount: 100 } });
		assert.equal(commands[4].input.Item?.page, 4);
		assert.equal(commands[4].input.Item?.pageToken, "resume");
		assert.equal(commands[4].input.Item?.scannedCount, 100);
	});

	it("treats conditional races as no-ops and propagates storage failures", async () => {
		const conflict = new ConditionalCheckFailedException({ $metadata: {}, message: "race" });
		const denied = harness(() => { throw conflict; }).store;
		assert.equal(await denied.startDiscovery(STATE), false);
		assert.equal(await denied.claimPage({ userId: USER, generation: "run-1", page: 0 }), false);
		await denied.failDiscovery({ userId: USER, generation: "run-1", error: "late" });
		const page = { previous: STATE, senders: [SENDER], mode: "history", pageToken: undefined, historyId: "102", state: "complete", scannedMessages: 25 } as const;
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
		const page = { previous: STATE, senders, mode: "history", pageToken: undefined, historyId: "102", state: "complete", scannedMessages: 25 } as const;
		const { store, commands } = harness();
		assert.equal(await store.savePage(page), true);
		assert.equal(commands.length, 2);
		assert.equal(commands[0].input.TransactItems?.length, 100);
		assert.match(JSON.stringify(commands[0].input.TransactItems?.[0]), /ConditionCheck/);
		assert.equal(commands[1].input.TransactItems?.length, 3);
		assert.equal(commands[1].input.TransactItems?.[0].Put.Item.recordKey, "STATE");
		const cancelled = harness(() => { throw new ConditionalCheckFailedException({ $metadata: {}, message: "deleted" }); });
		assert.equal(await cancelled.store.savePage(page), false);
		assert.equal(cancelled.commands.length, 1);
	});
});
