import assert from "node:assert/strict";
import type { DynamoDBDocumentClient } from "@packages/storage-client";
import { UserIdSchema } from "@packages/domain/user";
import { initDynamoDbOcrPagesLeft } from "./dynamodb-ocr-pages-left";

const TABLE = "test-rate-limits";
const USER = UserIdSchema.parse("reader-1");
const NOW_MS = 1_800_000_000_000;
const HOUR_START = 1_800_000_000 - (1_800_000_000 % 3600);

type Get = { input: { TableName?: string; Key?: Record<string, unknown>; ConsistentRead?: boolean } };

function fakeClient(item: Record<string, unknown> | undefined): { client: Pick<DynamoDBDocumentClient, "send">; gets: Get[] } {
	const gets: Get[] = [];
	return {
		gets,
		client: {
			send: async (command: unknown) => {
				gets.push(command as Get);
				return { Item: item };
			},
		},
	};
}

function readFor(client: Pick<DynamoDBDocumentClient, "send">) {
	return initDynamoDbOcrPagesLeft({ client, tableName: TABLE, now: () => new Date(NOW_MS) }).readOcrPagesLeft;
}

describe("initDynamoDbOcrPagesLeft", () => {
	it("reads the reader's OCR page counter row", async () => {
		const { client, gets } = fakeClient(undefined);

		await readFor(client)({ userId: USER });

		assert.equal(gets.length, 1);
		assert.equal(gets[0].input.TableName, TABLE);
		assert.deepEqual(gets[0].input.Key, { pk: `ocr-pages#${USER}` });
	});

	it("answers the whole daily allowance for a reader with no counter row", async () => {
		const { client } = fakeClient(undefined);

		assert.equal(await readFor(client)({ userId: USER }), 98);
	});

	it("subtracts the pages charged within the last 24 hours", async () => {
		const { client } = fakeClient({ pk: `ocr-pages#${USER}`, version: 2, slots: [{ slotStart: HOUR_START, pages: 60 }] });

		assert.equal(await readFor(client)({ userId: USER }), 38);
	});

	it("answers 0 once the day's pages are spent", async () => {
		const { client } = fakeClient({ pk: `ocr-pages#${USER}`, version: 1, slots: [{ slotStart: HOUR_START, pages: 98 }] });

		assert.equal(await readFor(client)({ userId: USER }), 0);
	});

	it("rejects a malformed counter row", async () => {
		const { client } = fakeClient({ pk: `ocr-pages#${USER}`, slots: "not-a-list" });

		await assert.rejects(readFor(client)({ userId: USER }));
	});
});
