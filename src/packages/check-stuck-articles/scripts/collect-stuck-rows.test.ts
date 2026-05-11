import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { collectStuckRows } from "./collect-stuck-rows";

type SendFn = DynamoDBDocumentClient["send"];

interface ScanCommandLike {
	input: {
		TableName?: string;
		FilterExpression?: string;
		ProjectionExpression?: string;
		ExpressionAttributeNames?: Record<string, string>;
		ExpressionAttributeValues?: Record<string, unknown>;
		ExclusiveStartKey?: Record<string, unknown>;
	};
}

interface ScanResultLike {
	Items?: Record<string, unknown>[];
	Count?: number;
	LastEvaluatedKey?: Record<string, unknown>;
}

function createFakeClient(
	impl: (input: ScanCommandLike) => ScanResultLike,
): { client: DynamoDBDocumentClient; calls: ScanCommandLike[] } {
	const calls: ScanCommandLike[] = [];
	const send = (async (command: ScanCommandLike) => {
		calls.push(command);
		return impl(command);
	}) as unknown as SendFn;
	const client = { send } as Partial<DynamoDBDocumentClient> as DynamoDBDocumentClient;
	return { client, calls };
}

const TABLE = "test-articles";
const ORIGIN = "https://example.test";

describe("collectStuckRows", () => {
	it("issues a Scan against the configured table with the canary FilterExpression", async () => {
		const { client, calls } = createFakeClient(() => ({ Items: [], Count: 0 }));
		await collectStuckRows({ client, tableName: TABLE, origin: ORIGIN });
		assert.equal(calls.length, 1);
		assert.equal(calls[0]?.input.TableName, TABLE);
		assert.equal(
			calls[0]?.input.FilterExpression,
			"summaryStatus = :pending " +
				"OR crawlStatus = :pending " +
				"OR (attribute_not_exists(summaryStatus) AND attribute_not_exists(crawlStatus) AND attribute_not_exists(summary)) " +
				"OR (summaryStatus = :ready AND attribute_not_exists(summary))",
		);
		assert.deepEqual(calls[0]?.input.ExpressionAttributeValues, {
			":pending": "pending",
			":ready": "ready",
		});
	});

	it("projects the attributes classifyRow and checkTerminalState consume", async () => {
		const { client, calls } = createFakeClient(() => ({ Items: [], Count: 0 }));
		await collectStuckRows({ client, tableName: TABLE, origin: ORIGIN });
		const projection = calls[0]?.input.ProjectionExpression ?? "";
		for (const attr of [
			"originalUrl",
			"summaryStatus",
			"crawlStatus",
			"summaryFailureReason",
			"crawlFailureReason",
			"contentFetchedAt",
			"summary",
		]) {
			assert.ok(projection.includes(attr), `ProjectionExpression must include ${attr}`);
		}
		assert.equal(calls[0]?.input.ExpressionAttributeNames?.["#u"], "url");
		assert.match(projection, /#u/);
	});

	it("returns a stuck row for a crawl-pending row, with reasons and a recrawl URL bound to origin", async () => {
		const { client } = createFakeClient(() => ({
			Items: [
				{
					url: "example.test/article",
					originalUrl: "https://example.test/article",
					crawlStatus: "pending",
				},
			],
			Count: 1,
		}));
		const stuck = await collectStuckRows({ client, tableName: TABLE, origin: ORIGIN });
		assert.equal(stuck.length, 1);
		assert.equal(stuck[0]?.originalUrl, "https://example.test/article");
		assert.deepEqual(stuck[0]?.reasons, ["crawl-pending"]);
		assert.equal(
			stuck[0]?.recrawlUrl,
			`${ORIGIN}/admin/recrawl/${encodeURIComponent("https://example.test/article")}`,
		);
		assert.match(
			stuck[0]?.terminalCheckMessage ?? "",
			/crawlStatus is 'pending'/,
		);
	});

	it("skips terminal rows (DDB may surface them via the writer-contract disjunct)", async () => {
		const { client } = createFakeClient(() => ({
			Items: [
				{
					url: "example.test/done",
					originalUrl: "https://example.test/done",
					summaryStatus: "ready",
					crawlStatus: "ready",
					summary: "the summary",
				},
			],
			Count: 1,
		}));
		const stuck = await collectStuckRows({ client, tableName: TABLE, origin: ORIGIN });
		assert.deepEqual(stuck, []);
	});

	it("drops a row whose originalUrl matches an operator-driven exclude pattern", async () => {
		const { client } = createFakeClient(() => ({
			Items: [
				{
					url: "readplace.com/some-page",
					originalUrl: "https://readplace.com/some-page",
					crawlStatus: "pending",
				},
			],
			Count: 1,
		}));
		const stuck = await collectStuckRows({ client, tableName: TABLE, origin: ORIGIN });
		assert.deepEqual(stuck, []);
	});

	it("drops a row missing originalUrl (cannot build a recrawl URL without it)", async () => {
		const { client } = createFakeClient(() => ({
			Items: [
				{
					url: "example.test/no-original",
					crawlStatus: "pending",
				},
			],
			Count: 1,
		}));
		const stuck = await collectStuckRows({ client, tableName: TABLE, origin: ORIGIN });
		assert.deepEqual(stuck, []);
	});

	it("paginates: a LastEvaluatedKey on page 1 triggers a second Scan with ExclusiveStartKey", async () => {
		let callIndex = 0;
		const { client, calls } = createFakeClient(() => {
			callIndex += 1;
			if (callIndex === 1) {
				return {
					Items: [
						{
							url: "page1.test/a",
							originalUrl: "https://page1.test/a",
							crawlStatus: "pending",
						},
					],
					Count: 1,
					LastEvaluatedKey: { url: "page1.test/a" },
				};
			}
			return {
				Items: [
					{
						url: "page2.test/b",
						originalUrl: "https://page2.test/b",
						summaryStatus: "pending",
					},
				],
				Count: 1,
			};
		});
		const stuck = await collectStuckRows({ client, tableName: TABLE, origin: ORIGIN });
		assert.equal(calls.length, 2);
		assert.equal(calls[0]?.input.ExclusiveStartKey, undefined);
		assert.deepEqual(calls[1]?.input.ExclusiveStartKey, { url: "page1.test/a" });
		assert.equal(stuck.length, 2);
	});

	it("surfaces the summary-ready-without-text writer-contract violation", async () => {
		const { client } = createFakeClient(() => ({
			Items: [
				{
					url: "example.test/missing-summary",
					originalUrl: "https://example.test/missing-summary",
					summaryStatus: "ready",
					crawlStatus: "ready",
				},
			],
			Count: 1,
		}));
		const stuck = await collectStuckRows({ client, tableName: TABLE, origin: ORIGIN });
		assert.equal(stuck.length, 1);
		assert.deepEqual(stuck[0]?.reasons, ["summary-ready-without-text"]);
	});
});
