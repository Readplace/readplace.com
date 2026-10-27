import assert from "node:assert/strict";
import { ConditionalCheckFailedException, type DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { GmailAccountEmailSchema, GmailMessageIdSchema } from "@packages/domain/gmail";
import { UserIdSchema } from "@packages/domain/user";
import { initDynamoDbGmailMessageUpdate } from "./dynamodb-gmail-message-update";

type SendFn = DynamoDBDocumentClient["send"];
interface Sent {
	name: string;
	input: Record<string, unknown> & { ExpressionAttributeValues?: Record<string, unknown> };
}

const USER = UserIdSchema.parse("user-1");
const RAM = "2026-10-27T00:00:00.000Z#<id@example.com>";
const ACCOUNT = GmailAccountEmailSchema.parse("Reader@gmail.com");
const ORIGIN = { kind: "history" as const, accountEmail: ACCOUNT, gmailMessageId: GmailMessageIdSchema.parse("m1") };
const NOW = new Date("2026-10-27T01:00:00.000Z");
const KEY = { userId: USER, recordKey: "GMAIL_UPDATE#reader@gmail.com#history#reader@gmail.com#m1" };
const PENDING_ROW = { ...KEY, receivedAtMessageId: RAM, origin: ORIGIN, status: "pending", requestedAt: NOW.toISOString() };

function conditionFailed(): ConditionalCheckFailedException {
	return new ConditionalCheckFailedException({ message: "condition", $metadata: {} });
}

function store(respond: (command: Sent) => unknown = () => ({})) {
	const sent: Sent[] = [];
	const send = (async (command: { constructor: { name: string }; input: Sent["input"] }) => {
		const recorded = { name: command.constructor.name, input: command.input };
		sent.push(recorded);
		return respond(recorded);
	}) as SendFn;
	const client = { send } as unknown as DynamoDBDocumentClient;
	return { updates: initDynamoDbGmailMessageUpdate({ client, tableName: "imports" }), sent };
}

describe("initDynamoDbGmailMessageUpdate", () => {
	it("records a new update as pending under an account-prefixed key", async () => {
		const { updates, sent } = store((command) => (command.name === "GetCommand" ? { Item: PENDING_ROW } : {}));
		const recorded = await updates.recordPending({ userId: USER, receivedAtMessageId: RAM, origin: ORIGIN, now: NOW });
		assert.deepEqual(recorded, { status: "pending", userId: USER, receivedAtMessageId: RAM, origin: ORIGIN, requestedAt: NOW.toISOString() });
		assert.deepEqual(sent[0].input.Item, PENDING_ROW);
		assert.equal(sent[0].input.ConditionExpression, "attribute_not_exists(recordKey)");
	});

	it("returns an already-completed record instead of reopening it", async () => {
		const completedRow = { ...PENDING_ROW, status: "completed", completedAt: NOW.toISOString() };
		const { updates } = store((command) => {
			if (command.name === "PutCommand") throw conditionFailed();
			return { Item: completedRow };
		});
		const recorded = await updates.recordPending({ userId: USER, receivedAtMessageId: RAM, origin: ORIGIN, now: NOW });
		assert.equal(recorded.status, "completed");
	});

	it("rethrows a write failure that is not a lost condition", async () => {
		const { updates } = store(() => {
			throw new Error("throttled");
		});
		await assert.rejects(updates.recordPending({ userId: USER, receivedAtMessageId: RAM, origin: ORIGIN, now: NOW }), /throttled/);
	});

	it("reads a failed record with its reason", async () => {
		const { updates } = store(() => ({ Item: { ...PENDING_ROW, status: "failed", failedAt: NOW.toISOString(), failureReason: "ambiguous-original" } }));
		const found = await updates.find({ userId: USER, origin: ORIGIN });
		assert.deepEqual(found, { userId: USER, receivedAtMessageId: RAM, origin: ORIGIN, requestedAt: NOW.toISOString(), status: "failed", failedAt: NOW.toISOString(), failureReason: "ambiguous-original" });
	});

	it("reads a missing record as undefined", async () => {
		const { updates } = store(() => ({}));
		assert.equal(await updates.find({ userId: USER, origin: ORIGIN }), undefined);
	});

	it("marks a record completed", async () => {
		const { updates, sent } = store();
		await updates.markCompleted({ userId: USER, origin: ORIGIN, now: NOW });
		assert.deepEqual(sent[0].input.Key, KEY);
		assert.equal(sent[0].input.ExpressionAttributeValues?.[":completed"], "completed");
	});

	it("marks only a pending record failed and reports the transition", async () => {
		const { updates, sent } = store();
		assert.equal(await updates.markFailed({ userId: USER, origin: ORIGIN, reason: "dead-lettered", now: NOW }), "failed");
		assert.match(String(sent[0].input.ConditionExpression), /#status = :pending/);
		assert.equal(sent[0].input.ExpressionAttributeValues?.[":pending"], "pending");
		assert.equal(sent[0].input.ExpressionAttributeValues?.[":reason"], "dead-lettered");
	});

	it("reports a settled record as unchanged when a later failure arrives", async () => {
		const { updates } = store(() => {
			throw conditionFailed();
		});
		assert.equal(await updates.markFailed({ userId: USER, origin: ORIGIN, reason: "dead-lettered", now: NOW }), "unchanged");
	});

	it("lists one account's pending updates with consistent, paginated key queries", async () => {
		let page = 0;
		const { updates, sent } = store(() => {
			page += 1;
			return page === 1
				? { Items: [PENDING_ROW], LastEvaluatedKey: KEY }
				: { Items: [{ ...PENDING_ROW, recordKey: `${KEY.recordKey}2` }] };
		});
		const pending = await updates.listPendingByAccount({ userId: USER, accountEmail: ACCOUNT });
		assert.equal(pending.length, 2);
		assert.equal(sent.length, 2);
		assert.equal(sent[0].input.ConsistentRead, true);
		assert.equal(sent[0].input.ExpressionAttributeValues?.[":prefix"], "GMAIL_UPDATE#reader@gmail.com#");
		assert.deepEqual(sent[1].input.ExclusiveStartKey, KEY);
	});
});
