import assert from "node:assert/strict";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { ConditionalCheckFailedException, type DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { UploadIdSchema } from "@packages/media-contracts";
import { initDynamoDbMediaUploadSessions } from "./dynamodb-media-upload-sessions";

const UPLOAD_ID = UploadIdSchema.parse("0123456789abcdef0123456789abcdef");
const OWNER = UserIdSchema.parse("a".repeat(32));
const OTHER = UserIdSchema.parse("b".repeat(32));
const SAVE_ATTEMPT_ID = SaveAttemptIdSchema.parse("attempt-1");
const NOW = new Date("2026-11-05T00:00:00Z");

type Stored = Record<string, unknown>;

function conditionalCheckFailed() {
	return new ConditionalCheckFailedException({ message: "The conditional request failed", $metadata: {} });
}

function createFakeTable() {
	const rows = new Map<string, Stored>();
	const updates: Stored[] = [];
	const send = async (command: {
		constructor: { name: string };
		input: {
			Item?: Stored;
			Key?: { uploadId: string };
			UpdateExpression?: string;
			ConditionExpression?: string;
			ExpressionAttributeNames?: Record<string, string>;
			ExpressionAttributeValues?: Stored;
		};
	}) => {
		const { input } = command;
		if (command.constructor.name === "UpdateCommand") updates.push(input);
		if (command.constructor.name === "PutCommand") {
			assert(input.Item);
			rows.set(String(input.Item.uploadId), input.Item);
			return {};
		}
		assert(input.Key);
		const row = rows.get(input.Key.uploadId);
		if (command.constructor.name === "GetCommand") return row ? { Item: row } : {};
		if (command.constructor.name === "UpdateCommand") {
			const values = input.ExpressionAttributeValues ?? {};
			const ownerMatches = !input.ConditionExpression?.includes("userId = :userId") || row?.userId === values[":userId"];
			if (row === undefined || !ownerMatches || row.status !== values[":from"]) throw conditionalCheckFailed();
			rows.set(input.Key.uploadId, { ...row, status: values[":to"] });
			return {};
		}
		throw new Error(`unexpected command ${command.constructor.name}`);
	};
	const client: Partial<DynamoDBDocumentClient> = { send: send as DynamoDBDocumentClient["send"] };
	return { rows, updates, client: client as DynamoDBDocumentClient };
}

function initStore(client: DynamoDBDocumentClient) {
	return initDynamoDbMediaUploadSessions({ client, tableName: "test-media-upload-sessions", now: () => NOW });
}

async function createStaged(store: ReturnType<typeof initStore>) {
	return store.createMediaUploadSession({
		uploadId: UPLOAD_ID,
		userId: OWNER,
		kind: "book",
		fileName: "Book upload",
		saveAttemptId: SAVE_ATTEMPT_ID,
	});
}

describe("initDynamoDbMediaUploadSessions", () => {
	it("creates a staged session that its owner finds, expiring 24 hours later", async () => {
		const { rows, client } = createFakeTable();
		const store = initStore(client);

		const created = await createStaged(store);

		assert.equal(created.status, "staged");
		assert.equal(rows.get(UPLOAD_ID)?.expiresAt, NOW.getTime() / 1000 + 24 * 60 * 60);
		const found = await store.findMediaUploadSession({ uploadId: UPLOAD_ID, userId: OWNER });
		assert.equal(found?.status, "staged");
		assert.equal(found?.fileName, "Book upload");
		assert.equal(found?.saveAttemptId, SAVE_ATTEMPT_ID);
	});

	it("keeps the declared byte length", async () => {
		const { client } = createFakeTable();
		const store = initStore(client);
		await store.createMediaUploadSession({
			uploadId: UPLOAD_ID,
			userId: OWNER,
			kind: "book",
			fileName: "dune.epub",
			byteLength: 2048,
			saveAttemptId: SAVE_ATTEMPT_ID,
		});

		const found = await store.findMediaUploadSession({ uploadId: UPLOAD_ID, userId: OWNER });

		assert.equal(found?.byteLength, 2048);
	});

	it("finds nothing for another user or a missing upload", async () => {
		const { client } = createFakeTable();
		const store = initStore(client);
		await createStaged(store);

		assert.equal(await store.findMediaUploadSession({ uploadId: UPLOAD_ID, userId: OTHER }), undefined);
		assert.equal(
			await store.findMediaUploadSession({ uploadId: UploadIdSchema.parse("f".repeat(32)), userId: OWNER }),
			undefined,
		);
	});

	it("moves staged to committed, then committed to failed", async () => {
		const { client } = createFakeTable();
		const store = initStore(client);
		await createStaged(store);

		assert.equal(await store.markMediaUploadCommitted({ uploadId: UPLOAD_ID, userId: OWNER }), "committed");
		assert.equal(await store.failMediaUpload({ uploadId: UPLOAD_ID }), "failed");

		const found = await store.findMediaUploadSession({ uploadId: UPLOAD_ID, userId: OWNER });
		assert.equal(found?.status, "failed");
	});

	it("conditions each transition on the owner and the current status, aliasing the reserved status attribute", async () => {
		const { updates, client } = createFakeTable();
		const store = initStore(client);
		await createStaged(store);

		await store.markMediaUploadCommitted({ uploadId: UPLOAD_ID, userId: OWNER });
		await store.failMediaUpload({ uploadId: UPLOAD_ID });

		assert.deepEqual(
			updates.map((update) => [
				update.UpdateExpression,
				update.ConditionExpression,
				update.ExpressionAttributeNames,
				update.ExpressionAttributeValues,
			]),
			[
				[
					"SET #status = :to",
					"userId = :userId AND #status = :from",
					{ "#status": "status" },
					{ ":userId": OWNER, ":from": "staged", ":to": "committed" },
				],
				["SET #status = :to", "#status = :from", { "#status": "status" }, { ":from": "committed", ":to": "failed" }],
			],
		);
	});

	it("refuses to commit a session that is not staged or not the caller's", async () => {
		const { client } = createFakeTable();
		const store = initStore(client);
		await createStaged(store);

		assert.equal(await store.markMediaUploadCommitted({ uploadId: UPLOAD_ID, userId: OTHER }), "not-staged");
		await store.markMediaUploadCommitted({ uploadId: UPLOAD_ID, userId: OWNER });
		assert.equal(await store.markMediaUploadCommitted({ uploadId: UPLOAD_ID, userId: OWNER }), "not-staged");
	});

	it("refuses to fail a session that was never committed", async () => {
		const { client } = createFakeTable();
		const store = initStore(client);
		await createStaged(store);

		assert.equal(await store.failMediaUpload({ uploadId: UPLOAD_ID }), "not-committed");
	});

	it("rethrows a write error that is not a refused condition", async () => {
		const client: Partial<DynamoDBDocumentClient> = {
			send: (async () => {
				throw new Error("throttled");
			}) as DynamoDBDocumentClient["send"],
		};
		const store = initStore(client as DynamoDBDocumentClient);

		await assert.rejects(store.failMediaUpload({ uploadId: UPLOAD_ID }), /throttled/);
	});
});
