import assert from "node:assert/strict";
import {
	type DynamoDBDocumentClient,
	TransactionCanceledException,
} from "@packages/storage-client";
import { UploadIdSchema } from "@packages/media-contracts";
import { z } from "zod";
import { initDynamoDbMediaObjects } from "./dynamodb-media-objects";
import type { ObjectMeta } from "./media-objects.types";
import { ObjectSha256Schema } from "./object-sha256";

const TransactItemsSchema = z.array(z.record(z.string(), z.record(z.string(), z.unknown())));

type Sent = { name: string; input: Record<string, unknown> };
type Answer = (command: Sent) => Promise<Record<string, unknown>>;

const TABLE = "hutch-media-test";
const SHA = ObjectSha256Schema.parse("c".repeat(64));
const OTHER_SHA = ObjectSha256Schema.parse("d".repeat(64));
const UPLOAD = UploadIdSchema.parse("e".repeat(32));
const META_KEY = { pk: `object#${SHA}`, sk: "meta" };
const REF_KEY = { pk: `object#${SHA}`, sk: `ref#${UPLOAD}` };
const HOLD_KEY = { pk: `upload#${UPLOAD}`, sk: `holds#${SHA}` };
const LIVE: ObjectMeta = { size: 2_048, mediaType: "audio/mp4", generation: 3, holders: 2, state: "live" };

function fakeClient(answer: Answer = async () => ({})) {
	const sent: Sent[] = [];
	const send = async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
		const record = { name: command.constructor.name, input: command.input };
		sent.push(record);
		return answer(record);
	};
	const client: Pick<DynamoDBDocumentClient, "send"> = { send: send as unknown as DynamoDBDocumentClient["send"] };
	return { sent, rows: initDynamoDbMediaObjects({ client, tableName: TABLE }) };
}

function cancelled(codes: string[] | undefined) {
	return new TransactionCanceledException({
		$metadata: {},
		message: "Transaction cancelled",
		CancellationReasons: codes?.map((Code) => ({ Code })),
	});
}

describe("initDynamoDbMediaObjects", () => {
	it("reads the meta and the upload's ref row with consistent reads", async () => {
		const { sent, rows } = fakeClient(async (command) => {
			const key = command.input.Key;
			assert(typeof key === "object" && key !== null && "sk" in key);
			return key.sk === "meta" ? { Item: { ...META_KEY, ...LIVE } } : { Item: REF_KEY };
		});

		const holding = await rows.readHolding({ sha256: SHA, uploadId: UPLOAD });

		assert.deepEqual(holding, { meta: LIVE, held: true });
		assert.deepEqual(
			sent.map((command) => command.input),
			[
				{ TableName: TABLE, Key: META_KEY, ConsistentRead: true },
				{ TableName: TABLE, Key: REF_KEY, ConsistentRead: true },
			],
		);
	});

	it("reports no holding when neither row exists", async () => {
		const { rows } = fakeClient();

		assert.deepEqual(await rows.readHolding({ sha256: SHA, uploadId: UPLOAD }), { meta: undefined, held: false });
	});

	it("writes a first holding conditioned on no meta and no ref row", async () => {
		const { sent, rows } = fakeClient();
		const meta: ObjectMeta = { ...LIVE, generation: 1, holders: 1 };

		const outcome = await rows.writeHolding({ sha256: SHA, uploadId: UPLOAD, meta, seen: undefined });

		assert.equal(outcome, "written");
		assert.equal(sent[0].name, "TransactWriteCommand");
		assert.deepEqual(sent[0].input.TransactItems, [
			{ Put: { TableName: TABLE, Item: { ...META_KEY, ...meta }, ConditionExpression: "attribute_not_exists(pk)" } },
			{ Put: { TableName: TABLE, Item: REF_KEY, ConditionExpression: "attribute_not_exists(pk)" } },
			{ Put: { TableName: TABLE, Item: { ...HOLD_KEY, sha256: SHA } } },
		]);
	});

	it("conditions a holding written over a seen meta on its state, generation and holders", async () => {
		const { sent, rows } = fakeClient();
		const meta: ObjectMeta = { ...LIVE, holders: 3 };

		await rows.writeHolding({ sha256: SHA, uploadId: UPLOAD, meta, seen: LIVE });

		const [put] = TransactItemsSchema.parse(sent[0].input.TransactItems);
		assert.deepEqual(put.Put, {
			TableName: TABLE,
			Item: { ...META_KEY, ...meta },
			ConditionExpression: "#state = :seenState AND #generation = :seenGeneration AND #holders = :seenHolders",
			ExpressionAttributeNames: { "#state": "state", "#generation": "generation", "#holders": "holders" },
			ExpressionAttributeValues: { ":seenState": "live", ":seenGeneration": 3, ":seenHolders": 2 },
		});
	});

	it("reports a conflict when the holding's transaction fails a condition", async () => {
		const { rows } = fakeClient(async () => {
			throw cancelled(["ConditionalCheckFailed", "None", "None"]);
		});

		assert.equal(await rows.writeHolding({ sha256: SHA, uploadId: UPLOAD, meta: LIVE, seen: undefined }), "conflict");
	});

	it.each([
		["a throttled transaction", cancelled(["ThrottlingError"])],
		["a cancellation without reasons", cancelled(undefined)],
		["any other error", new Error("network down")],
	])("rethrows %s", async (_label, error) => {
		const { rows } = fakeClient(async () => {
			throw error;
		});

		await assert.rejects(rows.writeHolding({ sha256: SHA, uploadId: UPLOAD, meta: LIVE, seen: undefined }), (thrown) => thrown === error);
	});

	it("releases a holding by rewriting the seen meta and deleting the ref row that must exist", async () => {
		const { sent, rows } = fakeClient();
		const meta: ObjectMeta = { ...LIVE, holders: 0, state: "deleting" };

		const outcome = await rows.releaseHolding({ sha256: SHA, uploadId: UPLOAD, meta, seen: { ...LIVE, holders: 1 } });

		assert.equal(outcome, "released");
		const [put, remove] = TransactItemsSchema.parse(sent[0].input.TransactItems);
		assert.deepEqual(put.Put.Item, { ...META_KEY, ...meta });
		assert.deepEqual(put.Put.ExpressionAttributeValues, { ":seenState": "live", ":seenGeneration": 3, ":seenHolders": 1 });
		assert.deepEqual(remove.Delete, { TableName: TABLE, Key: REF_KEY, ConditionExpression: "attribute_exists(pk)" });
	});

	it("reports a conflict when a release fails a condition", async () => {
		const { rows } = fakeClient(async () => {
			throw cancelled(["None", "ConditionalCheckFailed"]);
		});

		assert.equal(await rows.releaseHolding({ sha256: SHA, uploadId: UPLOAD, meta: LIVE, seen: LIVE }), "conflict");
	});

	it("lists every held object across query pages with consistent reads", async () => {
		const { sent, rows } = fakeClient(async (command) =>
			command.input.ExclusiveStartKey === undefined
				? { Items: [{ ...HOLD_KEY, sha256: SHA }], LastEvaluatedKey: HOLD_KEY }
				: { Items: [{ pk: `upload#${UPLOAD}`, sk: `holds#${OTHER_SHA}`, sha256: OTHER_SHA }] },
		);

		assert.deepEqual(await rows.listHeldObjects({ uploadId: UPLOAD }), [SHA, OTHER_SHA]);
		assert.deepEqual(sent[0].input, {
			TableName: TABLE,
			KeyConditionExpression: "pk = :pk AND begins_with(sk, :holds)",
			ExpressionAttributeValues: { ":pk": `upload#${UPLOAD}`, ":holds": "holds#" },
			ConsistentRead: true,
			ExclusiveStartKey: undefined,
		});
		assert.deepEqual(sent[1].input.ExclusiveStartKey, HOLD_KEY);
	});

	it("reads the meta with a consistent read", async () => {
		const { sent, rows } = fakeClient(async () => ({ Item: { ...META_KEY, ...LIVE } }));

		assert.deepEqual(await rows.readMeta({ sha256: SHA }), LIVE);
		assert.deepEqual(sent[0].input, { TableName: TABLE, Key: META_KEY, ConsistentRead: true });
	});

	it("deletes the upload's holds row", async () => {
		const { sent, rows } = fakeClient();

		await rows.deleteHold({ sha256: SHA, uploadId: UPLOAD });

		assert.deepEqual(sent[0], { name: "DeleteCommand", input: { TableName: TABLE, Key: HOLD_KEY } });
	});
});
