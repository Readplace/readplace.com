import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DynamoDBDocumentClient } from "@packages/storage-client";
import { initFailureHistoryMemberships } from "./failure-history-memberships";

type Query = {
	input: {
		TableName: string;
		IndexName: string;
		KeyConditionExpression: string;
		ProjectionExpression: string;
		ExpressionAttributeValues: Record<string, string>;
		ExclusiveStartKey?: Record<string, unknown>;
	};
};

type Result = { Items: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> };
const savedAt = "2026-05-10T00:00:00.000Z";
const viewedAt = "2026-05-10T01:00:00.000Z";

function testReader(send: (query: Query, options: { abortSignal: AbortSignal }) => Promise<Result>) {
	return initFailureHistoryMemberships({
		client: { send: send as unknown as DynamoDBDocumentClient["send"] },
		tableName: "fake-user-articles",
	});
}

describe("failed article history memberships", () => {
	it("reads every page of the physical key's URL index without retaining account identifiers", async () => {
		const calls: Query["input"][] = [];
		const read = testReader(async ({ input }) => {
			calls.push(input);
			return input.ExclusiveStartKey === undefined ? {
				Items: [
					{ userId: "sample-owner", status: "unread", savedAt },
					{ userId: "deleted-owner#removed", status: "unread", savedAt, viewedAt },
				],
				LastEvaluatedKey: { url: "example.test/post", userId: "sample-owner" },
			} : {
				Items: [
					{ userId: "sample-owner#queue/work", status: "read", savedAt, viewedAt },
					{ userId: "namespace", savedAt },
				],
			};
		});
		assert.deepEqual(await read(["example.test/post"]), new Map([
			["example.test/post", [{ savedAt, viewedAt: undefined }, { savedAt, viewedAt }]],
		]));
		assert.deepEqual(calls.map((call) => [
			call.TableName, call.IndexName, call.KeyConditionExpression,
			call.ProjectionExpression, call.ExpressionAttributeValues, call.ExclusiveStartKey,
		]), [
			["fake-user-articles", "url-index", "#url = :url", "userId, #status, savedAt, viewedAt", { ":url": "example.test/post" }, undefined],
			["fake-user-articles", "url-index", "#url = :url", "userId, #status, savedAt, viewedAt", { ":url": "example.test/post" }, { url: "example.test/post", userId: "sample-owner" }],
		]);
	});

	it("isolates partial page failures and malformed live membership from complete empty reads", async () => {
		const read = testReader(async ({ input }) => {
			if (input.ExpressionAttributeValues[":url"] === "bad-membership.test") return { Items: [{ userId: "sample-owner", status: "unread" }] };
			if (input.ExpressionAttributeValues[":url"] !== "failed-page.test") return { Items: [] };
			if (input.ExclusiveStartKey !== undefined) throw new Error("unavailable");
			return { Items: [{ userId: "sample-owner", status: "unread", savedAt }], LastEvaluatedKey: { url: "failed-page.test" } };
		});
		assert.deepEqual(await read(["failed-page.test", "bad-membership.test", "empty.test"]), new Map([
			["empty.test", []],
		]));
	});

	it("bounds concurrent index reads for a multi-page report", async () => {
		let active = 0;
		let maximum = 0;
		const read = testReader(async () => {
			active += 1;
			maximum = Math.max(maximum, active);
			await new Promise<void>((resolve) => setImmediate(resolve));
			active -= 1;
			return { Items: [] };
		});
		const results = await read(Array.from({ length: 14 }, (_unused, index) => `example.test/${index}`));
		assert.equal(results.size, 14);
		assert.equal(maximum, 6);
	});

	it("does not start a membership query when the evidence budget has expired", async () => {
		let requests = 0;
		const read = testReader(async () => {
			requests += 1;
			return { Items: [] };
		});
		assert.deepEqual(await read(["example.test/post"], AbortSignal.abort()), new Map());
		assert.equal(requests, 0);
	});

	it("returns completed keys on abort without waiting for stalled requests or starting queued keys", { timeout: 1_000 }, async () => {
		const controller = new AbortController();
		const calls: string[] = [];
		const stalled = new Promise<Result>(() => undefined);
		const read = testReader(async ({ input }, options) => {
			assert.equal(options.abortSignal, controller.signal);
			const key = input.ExpressionAttributeValues[":url"];
			assert(key);
			calls.push(key);
			if (key === "complete.test") return { Items: [{ userId: "owner", status: "unread", savedAt }] };
			if (input.ExclusiveStartKey === undefined) {
				return { Items: [{ userId: "owner", status: "unread", savedAt }], LastEvaluatedKey: { url: key } };
			}
			return stalled;
		});
		const firstBatch = ["complete.test", ...Array.from({ length: 5 }, (_unused, index) => `stalled.test/${index}`)];
		const pending = read([...firstBatch, "queued.test"], controller.signal);
		await new Promise<void>((resolve) => setImmediate(resolve));
		controller.abort();
		assert.deepEqual(await pending, new Map([
			["complete.test", [{ savedAt, viewedAt: undefined }]],
		]));
		assert.deepEqual(calls, [...firstBatch, ...firstBatch.slice(1)]);
	});
});
