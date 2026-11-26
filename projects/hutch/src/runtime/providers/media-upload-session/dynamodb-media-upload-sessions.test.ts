import assert from "node:assert/strict";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { ConditionalCheckFailedException, type DynamoDBDocumentClient } from "@packages/storage-client";
import { UploadIdSchema } from "@packages/media-contracts";
import { initDynamoDbMediaUploadSessions } from "./dynamodb-media-upload-sessions";

const UPLOAD_ID = UploadIdSchema.parse("0123456789abcdef0123456789abcdef");
const OWNER = UserIdSchema.parse("a".repeat(32));
const OTHER = UserIdSchema.parse("b".repeat(32));
const SAVE_ATTEMPT_ID = SaveAttemptIdSchema.parse("attempt-1");

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
			Key?: { uploadId: string };
			UpdateExpression?: string;
			ConditionExpression?: string;
			ExpressionAttributeNames?: Record<string, string>;
			ExpressionAttributeValues?: Stored;
		};
	}) => {
		const { input } = command;
		if (command.constructor.name === "UpdateCommand") updates.push(input);
		assert(input.Key);
		const row = rows.get(input.Key.uploadId);
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
	return initDynamoDbMediaUploadSessions({ client, tableName: "test-media-upload-sessions" });
}

function seedStaged(rows: Map<string, Stored>) {
	rows.set(UPLOAD_ID, {
		uploadId: UPLOAD_ID,
		userId: OWNER,
		kind: "book",
		fileName: "Book upload",
		saveAttemptId: SAVE_ATTEMPT_ID,
		status: "staged",
	});
}

describe("initDynamoDbMediaUploadSessions", () => {
	it("moves staged to committed, then committed to failed", async () => {
		const { rows, client } = createFakeTable();
		const store = initStore(client);
		seedStaged(rows);

		assert.equal(await store.markMediaUploadCommitted({ uploadId: UPLOAD_ID, userId: OWNER }), "committed");
		assert.equal(await store.failMediaUpload({ uploadId: UPLOAD_ID }), "failed");

		assert.equal(rows.get(UPLOAD_ID)?.status, "failed");
	});

	it("conditions each transition on the owner and the current status, aliasing the reserved status attribute", async () => {
		const { rows, updates, client } = createFakeTable();
		const store = initStore(client);
		seedStaged(rows);

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
		const { rows, client } = createFakeTable();
		const store = initStore(client);
		seedStaged(rows);

		assert.equal(await store.markMediaUploadCommitted({ uploadId: UPLOAD_ID, userId: OTHER }), "not-staged");
		await store.markMediaUploadCommitted({ uploadId: UPLOAD_ID, userId: OWNER });
		assert.equal(await store.markMediaUploadCommitted({ uploadId: UPLOAD_ID, userId: OWNER }), "not-staged");
	});

	it("refuses to fail a session that was never committed", async () => {
		const { rows, client } = createFakeTable();
		const store = initStore(client);
		seedStaged(rows);

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
