import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import {
	CRAWL_MIN_AGE_MS,
	SUMMARY_MIN_AGE_MS,
	buildScanInput,
	collectStuckRows,
} from "./collect-stuck-rows";

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

const NOW = new Date("2026-05-11T12:00:00.000Z");
const TABLE = "test-articles";
const ORIGIN = "https://example.test";

describe("buildScanInput", () => {
	it("anchors the age-gate thresholds to (now - constant) per axis", () => {
		const input = buildScanInput(NOW);
		assert.equal(
			input.ExpressionAttributeValues[":crawlMinAge"],
			new Date(NOW.getTime() - CRAWL_MIN_AGE_MS).toISOString(),
		);
		assert.equal(
			input.ExpressionAttributeValues[":summaryMinAge"],
			new Date(NOW.getTime() - SUMMARY_MIN_AGE_MS).toISOString(),
		);
	});

	it("age-gates the crawl-pending disjunct with contentFetchedAt OR firstSeenAt OR neither-present", () => {
		const input = buildScanInput(NOW);
		assert.match(
			input.FilterExpression,
			/crawlStatus = :pending AND \(contentFetchedAt < :crawlMinAge OR \(attribute_not_exists\(contentFetchedAt\) AND firstSeenAt < :crawlMinAge\) OR \(attribute_not_exists\(contentFetchedAt\) AND attribute_not_exists\(firstSeenAt\)\)\)/,
		);
	});

	it("age-gates the summary-pending disjunct with contentFetchedAt OR firstSeenAt OR neither-present", () => {
		const input = buildScanInput(NOW);
		assert.match(
			input.FilterExpression,
			/summaryStatus = :pending AND \(contentFetchedAt < :summaryMinAge OR \(attribute_not_exists\(contentFetchedAt\) AND firstSeenAt < :summaryMinAge\) OR \(attribute_not_exists\(contentFetchedAt\) AND attribute_not_exists\(firstSeenAt\)\)\)/,
		);
	});

	it("does NOT age-gate the legacy-stub disjunct (legacy stubs are stuck forever regardless of age)", () => {
		const input = buildScanInput(NOW);
		assert.match(
			input.FilterExpression,
			/OR \(attribute_not_exists\(summaryStatus\) AND attribute_not_exists\(crawlStatus\) AND attribute_not_exists\(summary\)\)/,
		);
		const legacyClause =
			"(attribute_not_exists(summaryStatus) AND attribute_not_exists(crawlStatus) AND attribute_not_exists(summary))";
		const idx = input.FilterExpression.indexOf(legacyClause);
		const after = input.FilterExpression.slice(idx + legacyClause.length);
		assert.ok(
			!after.startsWith(" AND "),
			"legacy-stub disjunct must not be followed by an age conjunction",
		);
	});

	it("does NOT age-gate the summary-ready-without-text writer-contract violation (never a timing artefact)", () => {
		const input = buildScanInput(NOW);
		assert.match(
			input.FilterExpression,
			/OR \(summaryStatus = :ready AND attribute_not_exists\(summary\)\)/,
		);
		assert.ok(
			!input.FilterExpression.includes(
				"summaryStatus = :ready AND attribute_not_exists(summary) AND",
			),
			"summary-ready-without-text disjunct must not carry an age conjunction",
		);
	});

	it("projects firstSeenAt so the canary can diagnose age-gate decisions in stderr", () => {
		const input = buildScanInput(NOW);
		assert.ok(
			input.ProjectionExpression.includes("firstSeenAt"),
			"firstSeenAt must be projected — without it the canary cannot tell why a row crossed the gate",
		);
	});

	it("aliases the reserved 'url' keyword via #u to keep ProjectionExpression valid", () => {
		const input = buildScanInput(NOW);
		assert.equal(input.ExpressionAttributeNames["#u"], "url");
		assert.match(input.ProjectionExpression, /#u/);
	});
});

describe("collectStuckRows", () => {
	it("issues a Scan against the configured table with the buildScanInput body", async () => {
		const { client, calls } = createFakeClient(() => ({ Items: [], Count: 0 }));
		await collectStuckRows({
			client,
			tableName: TABLE,
			origin: ORIGIN,
			now: () => NOW,
		});
		assert.equal(calls.length, 1);
		assert.equal(calls[0]?.input.TableName, TABLE);
		const expected = buildScanInput(NOW);
		assert.equal(calls[0]?.input.FilterExpression, expected.FilterExpression);
		assert.equal(calls[0]?.input.ProjectionExpression, expected.ProjectionExpression);
		assert.deepEqual(
			calls[0]?.input.ExpressionAttributeValues,
			expected.ExpressionAttributeValues,
		);
	});

	it("projects the attributes classifyRow and checkTerminalState consume", async () => {
		const { client, calls } = createFakeClient(() => ({ Items: [], Count: 0 }));
		await collectStuckRows({
			client,
			tableName: TABLE,
			origin: ORIGIN,
			now: () => NOW,
		});
		const projection = calls[0]?.input.ProjectionExpression ?? "";
		for (const attr of [
			"originalUrl",
			"summaryStatus",
			"crawlStatus",
			"summaryFailureReason",
			"crawlFailureReason",
			"contentFetchedAt",
			"firstSeenAt",
			"summary",
		]) {
			assert.ok(projection.includes(attr), `ProjectionExpression must include ${attr}`);
		}
		assert.equal(calls[0]?.input.ExpressionAttributeNames?.["#u"], "url");
		assert.match(projection, /#u/);
	});

	it("returns a stuck row for a crawl-pending row that DDB surfaced (server-side age gate has already let it through)", async () => {
		// DDB's FilterExpression applies the age gate server-side, so we only
		// need to simulate a row that has already crossed it.
		const { client } = createFakeClient(() => ({
			Items: [
				{
					url: "example.test/article",
					originalUrl: "https://example.test/article",
					crawlStatus: "pending",
					firstSeenAt: new Date(NOW.getTime() - 30 * 60_000).toISOString(),
				},
			],
			Count: 1,
		}));
		const stuck = await collectStuckRows({
			client,
			tableName: TABLE,
			origin: ORIGIN,
			now: () => NOW,
		});
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
		const stuck = await collectStuckRows({
			client,
			tableName: TABLE,
			origin: ORIGIN,
			now: () => NOW,
		});
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
		const stuck = await collectStuckRows({
			client,
			tableName: TABLE,
			origin: ORIGIN,
			now: () => NOW,
		});
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
		const stuck = await collectStuckRows({
			client,
			tableName: TABLE,
			origin: ORIGIN,
			now: () => NOW,
		});
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
							firstSeenAt: new Date(NOW.getTime() - 30 * 60_000).toISOString(),
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
						firstSeenAt: new Date(NOW.getTime() - 30 * 60_000).toISOString(),
					},
				],
				Count: 1,
			};
		});
		const stuck = await collectStuckRows({
			client,
			tableName: TABLE,
			origin: ORIGIN,
			now: () => NOW,
		});
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
		const stuck = await collectStuckRows({
			client,
			tableName: TABLE,
			origin: ORIGIN,
			now: () => NOW,
		});
		assert.equal(stuck.length, 1);
		assert.deepEqual(stuck[0]?.reasons, ["summary-ready-without-text"]);
	});
});
