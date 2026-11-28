import assert from "node:assert/strict";
import { type DynamoDBDocumentClient, TransactionCanceledException } from "@packages/storage-client";
import { UserIdSchema } from "@packages/domain/user";
import { initDynamoDbOcrPageQuota } from "./dynamodb-ocr-page-quota";

type SendFn = DynamoDBDocumentClient["send"];

type Command = { constructor: { name: string }; input: Record<string, unknown> };

type TransactPut = { Put: { Item: Record<string, unknown>; ConditionExpression: string; ExpressionAttributeValues?: Record<string, unknown> } };

const TABLE = "test-rate-limits";
const USER = UserIdSchema.parse("reader-1");
const NOW_MS = 1_800_000_000_000;
const HOUR_START = 1_800_000_000 - (1_800_000_000 % 3600);
const now = () => new Date(NOW_MS);
const noDelay = async () => {};

function fakeClient(params: {
	claim?: Record<string, unknown>;
	counter?: Record<string, unknown>;
	transact?: (command: Command, call: number) => unknown;
}): { client: DynamoDBDocumentClient; commands: Command[] } {
	const commands: Command[] = [];
	let transactCalls = 0;
	const send = async (command: Command) => {
		commands.push(command);
		if (command.constructor.name === "GetCommand") {
			const key = command.input.Key as { pk: string };
			return { Item: key.pk.startsWith("ocr-pages-claim#") ? params.claim : params.counter };
		}
		transactCalls += 1;
		return params.transact ? params.transact(command, transactCalls) : {};
	};
	const client: Partial<DynamoDBDocumentClient> = { send: send as unknown as SendFn };
	return { client: client as DynamoDBDocumentClient, commands };
}

function cancelled(codes: (string | undefined)[] | undefined): TransactionCanceledException {
	return new TransactionCanceledException({
		$metadata: {},
		message: "transaction cancelled",
		CancellationReasons: codes?.map((Code) => ({ Code })),
	});
}

function transactItems(commands: Command[]): TransactPut[] {
	const transact = commands.find((command) => command.constructor.name === "TransactWriteCommand");
	assert.ok(transact);
	return transact.input.TransactItems as TransactPut[];
}

function charge(client: DynamoDBDocumentClient, delay: (milliseconds: number) => Promise<void> = noDelay) {
	return initDynamoDbOcrPageQuota({ client, tableName: TABLE, now, delay }).chargeOcrPagesFor({
		userId: USER,
		claimId: "msg-1",
	});
}

describe("initDynamoDbOcrPageQuota", () => {
	it("opens the reader's counter and claims the charge in one transaction", async () => {
		const { client, commands } = fakeClient({});

		assert.deepEqual(await charge(client)({ pages: 40 }), { allowed: true });

		const [claim, counter] = transactItems(commands);
		assert.deepEqual(claim.Put.Item, { pk: "ocr-pages-claim#reader-1#msg-1", expiresAt: 1_800_000_000 + 25 * 3600 });
		assert.equal(claim.Put.ConditionExpression, "attribute_not_exists(pk)");
		assert.deepEqual(counter.Put.Item, {
			pk: "ocr-pages#reader-1",
			slots: [{ slotStart: HOUR_START, pages: 40 }],
			version: 1,
			expiresAt: 1_800_000_000 + 25 * 3600,
		});
		assert.equal(counter.Put.ConditionExpression, "attribute_not_exists(pk)");
	});

	it("adds to an existing counter under its version", async () => {
		const { client, commands } = fakeClient({
			counter: { pk: "ocr-pages#reader-1", version: 4, slots: [{ slotStart: HOUR_START - 3600, pages: 50 }] },
		});

		assert.deepEqual(await charge(client)({ pages: 48 }), { allowed: true });

		const [, counter] = transactItems(commands);
		assert.equal(counter.Put.ConditionExpression, "version = :version");
		assert.deepEqual(counter.Put.ExpressionAttributeValues, { ":version": 4 });
		assert.deepEqual(counter.Put.Item.slots, [
			{ slotStart: HOUR_START - 3600, pages: 50 },
			{ slotStart: HOUR_START, pages: 48 },
		]);
		assert.equal(counter.Put.Item.version, 5);
	});

	it("refuses without writing when the pages do not fit", async () => {
		const { client, commands } = fakeClient({
			counter: { pk: "ocr-pages#reader-1", version: 2, slots: [{ slotStart: HOUR_START - 3600, pages: 90 }] },
		});

		const result = await charge(client)({ pages: 20 });

		assert.deepEqual(result, {
			allowed: false,
			pagesLeft: 8,
			retryAt: new Date((HOUR_START - 3600 + 3600 + 86_400) * 1000),
		});
		assert.equal(commands.some((command) => command.constructor.name === "TransactWriteCommand"), false);
	});

	it("allows a charge already claimed, without reading or adding to the counter", async () => {
		const { client, commands } = fakeClient({ claim: { pk: "ocr-pages-claim#reader-1#msg-1" } });

		assert.deepEqual(await charge(client)({ pages: 98 }), { allowed: true });

		assert.deepEqual(commands.map((command) => command.constructor.name), ["GetCommand"]);
	});

	it("allows without a second count when the claim condition cancels the transaction", async () => {
		const { client } = fakeClient({ transact: () => { throw cancelled(["ConditionalCheckFailed", "None"]); } });

		assert.deepEqual(await charge(client)({ pages: 10 }), { allowed: true });
	});

	it.each([
		["a version conflict", ["None", "ConditionalCheckFailed"]],
		["a transaction conflict", ["None", "TransactionConflict"]],
	])("retries after %s and re-reads the counter", async (_label, codes) => {
		const delays: number[] = [];
		const { client, commands } = fakeClient({
			transact: (_command, call) => {
				if (call === 1) throw cancelled(codes);
				return {};
			},
		});

		assert.deepEqual(await charge(client, async (ms) => { delays.push(ms); })({ pages: 10 }), { allowed: true });

		assert.equal(delays.length, 1);
		assert.equal(commands.filter((command) => command.constructor.name === "GetCommand").length, 3);
	});

	it("rethrows once the conflict retries are spent", async () => {
		const { client, commands } = fakeClient({ transact: () => { throw cancelled(["None", "ConditionalCheckFailed"]); } });

		await assert.rejects(charge(client)({ pages: 10 }), TransactionCanceledException);

		assert.equal(commands.filter((command) => command.constructor.name === "TransactWriteCommand").length, 6);
	});

	it("rethrows a cancellation that is not a quota decision", async () => {
		const { client } = fakeClient({ transact: () => { throw cancelled(undefined); } });

		await assert.rejects(charge(client)({ pages: 10 }), TransactionCanceledException);
	});

	it("rethrows an SDK error", async () => {
		const { client } = fakeClient({ transact: () => { throw new Error("throttled"); } });

		await assert.rejects(charge(client)({ pages: 10 }), /throttled/);
	});
});
