import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import {
	buildScanInput,
	collectFailedRows,
} from "./collect-failed-rows";

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

const NOW = new Date("2026-05-18T12:00:00.000Z");
const TABLE = "test-articles";
const ORIGIN = "https://example.test";
const NO_EXCLUDES: readonly RegExp[] = [];

describe("buildScanInput", () => {
	it("requires both axes to be present and non-pending so legacy stub rows are excluded", () => {
		const input = buildScanInput(NOW, 0);
		assert.match(
			input.FilterExpression,
			/attribute_exists\(crawlStatus\) AND attribute_exists\(summaryStatus\)/,
		);
		assert.match(
			input.FilterExpression,
			/crawlStatus <> :pending AND summaryStatus <> :pending/,
		);
	});

	it("matches the three real-failure terminal values; summary-skipped is intentionally NOT a failure", () => {
		const input = buildScanInput(NOW, 0);
		assert.match(input.FilterExpression, /crawlStatus = :crawlFailed/);
		assert.match(input.FilterExpression, /crawlStatus = :crawlUnsupported/);
		assert.match(input.FilterExpression, /summaryStatus = :summaryFailed/);
		assert.equal(input.ExpressionAttributeValues[":crawlFailed"], "failed");
		assert.equal(input.ExpressionAttributeValues[":crawlUnsupported"], "unsupported");
		assert.equal(input.ExpressionAttributeValues[":summaryFailed"], "failed");
		assert.ok(
			!("summarySkipped" in input.ExpressionAttributeValues) &&
				!input.FilterExpression.includes("summarySkipped"),
			"summary-skipped must not appear in the filter — it is a successful terminal outcome",
		);
	});

	it("omits the savedAt time gate when lookbackDays = 0 (operator wants full history)", () => {
		const input = buildScanInput(NOW, 0);
		assert.ok(
			!input.FilterExpression.includes("savedAt"),
			`expected no savedAt clause, got: ${input.FilterExpression}`,
		);
		assert.equal(input.ExpressionAttributeValues[":since"], undefined);
	});

	it("anchors the savedAt time gate to (now - lookbackDays) when lookbackDays > 0", () => {
		const input = buildScanInput(NOW, 7);
		assert.match(input.FilterExpression, /savedAt >= :since/);
		const expected = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
		assert.equal(input.ExpressionAttributeValues[":since"], expected);
	});

	it("rejects negative or non-integer lookbackDays values (caller bug)", () => {
		assert.throws(() => buildScanInput(NOW, -1), /non-negative integer/);
		assert.throws(() => buildScanInput(NOW, 1.5), /non-negative integer/);
	});

	it("projects the failure-reason attributes the canary actually reports on", () => {
		const input = buildScanInput(NOW, 0);
		for (const attr of [
			"originalUrl",
			"crawlStatus",
			"crawlFailureReason",
			"crawlUnsupportedReason",
			"summaryStatus",
			"summaryFailureReason",
			"contentFetchedAt",
			"savedAt",
		]) {
			assert.ok(
				input.ProjectionExpression.includes(attr),
				`ProjectionExpression must include ${attr}`,
			);
		}
		assert.ok(
			!input.ProjectionExpression.includes("summarySkippedReason"),
			"summarySkippedReason is not surfaced — summary-skipped is a successful outcome",
		);
	});

	it("aliases the reserved 'url' keyword via #u to keep ProjectionExpression valid", () => {
		const input = buildScanInput(NOW, 0);
		assert.equal(input.ExpressionAttributeNames["#u"], "url");
		assert.match(input.ProjectionExpression, /#u/);
	});
});

describe("collectFailedRows", () => {
	it("issues a Scan against the configured table with the buildScanInput body", async () => {
		const { client, calls } = createFakeClient(() => ({ Items: [], Count: 0 }));
		await collectFailedRows({
			client,
			tableName: TABLE,
			origin: ORIGIN,
			now: () => NOW,
			lookbackDays: 0,
			excludePatterns: NO_EXCLUDES,
		});
		assert.equal(calls.length, 1);
		assert.equal(calls[0]?.input.TableName, TABLE);
		const expected = buildScanInput(NOW, 0);
		assert.equal(calls[0]?.input.FilterExpression, expected.FilterExpression);
		assert.equal(calls[0]?.input.ProjectionExpression, expected.ProjectionExpression);
		assert.deepEqual(
			calls[0]?.input.ExpressionAttributeValues,
			expected.ExpressionAttributeValues,
		);
	});

	it("classifies a crawl-failed row and surfaces its failure reason; summary-skipped is silently dropped", async () => {
		const { client } = createFakeClient(() => ({
			Items: [
				{
					url: "site.test/broken",
					originalUrl: "https://site.test/broken",
					crawlStatus: "failed",
					crawlFailureReason: '{"kind":"http-error","status":403}',
					summaryStatus: "skipped",
					savedAt: "2026-05-10T00:00:00.000Z",
				},
			],
			Count: 1,
		}));
		const failed = await collectFailedRows({
			client,
			tableName: TABLE,
			origin: ORIGIN,
			now: () => NOW,
			lookbackDays: 0,
			excludePatterns: NO_EXCLUDES,
		});
		assert.equal(failed.length, 1);
		assert.equal(failed[0]?.originalUrl, "https://site.test/broken");
		assert.deepEqual(failed[0]?.axes, ["crawl-failed"]);
		assert.equal(failed[0]?.reasons["crawl-failed"], '{"kind":"http-error","status":403}');
		assert.equal(
			failed[0]?.recrawlUrl,
			`${ORIGIN}/admin/recrawl/${encodeURIComponent("https://site.test/broken")}`,
		);
	});

	it("classifies a crawl-unsupported row and surfaces its unsupported reason", async () => {
		const { client } = createFakeClient(() => ({
			Items: [
				{
					url: "site.test/pdf",
					originalUrl: "https://site.test/paper.pdf",
					crawlStatus: "unsupported",
					crawlUnsupportedReason: '{"kind":"non-html-content","contentType":"application/pdf"}',
					summaryStatus: "skipped",
					savedAt: "2026-05-10T00:00:00.000Z",
				},
			],
			Count: 1,
		}));
		const failed = await collectFailedRows({
			client,
			tableName: TABLE,
			origin: ORIGIN,
			now: () => NOW,
			lookbackDays: 0,
			excludePatterns: NO_EXCLUDES,
		});
		assert.equal(failed.length, 1);
		assert.deepEqual(failed[0]?.axes, ["crawl-unsupported"]);
		assert.equal(
			failed[0]?.reasons["crawl-unsupported"],
			'{"kind":"non-html-content","contentType":"application/pdf"}',
		);
	});

	it("classifies a summary-only-failed row whose crawl succeeded", async () => {
		const { client } = createFakeClient(() => ({
			Items: [
				{
					url: "site.test/long",
					originalUrl: "https://site.test/long",
					crawlStatus: "ready",
					summaryStatus: "failed",
					summaryFailureReason: '{"kind":"exhausted-retries","receiveCount":3}',
					savedAt: "2026-05-10T00:00:00.000Z",
				},
			],
			Count: 1,
		}));
		const failed = await collectFailedRows({
			client,
			tableName: TABLE,
			origin: ORIGIN,
			now: () => NOW,
			lookbackDays: 0,
			excludePatterns: NO_EXCLUDES,
		});
		assert.equal(failed.length, 1);
		assert.deepEqual(failed[0]?.axes, ["summary-failed"]);
	});

	it("skips a row whose only non-ready axis is summary-skipped (now a success outcome)", async () => {
		const { client } = createFakeClient(() => ({
			Items: [
				{
					url: "site.test/short",
					originalUrl: "https://site.test/short",
					crawlStatus: "ready",
					summaryStatus: "skipped",
					savedAt: "2026-05-10T00:00:00.000Z",
				},
			],
			Count: 1,
		}));
		const failed = await collectFailedRows({
			client,
			tableName: TABLE,
			origin: ORIGIN,
			now: () => NOW,
			lookbackDays: 0,
			excludePatterns: NO_EXCLUDES,
		});
		assert.deepEqual(failed, []);
	});

	it("skips fully ready rows (DDB may still surface them when paginating)", async () => {
		const { client } = createFakeClient(() => ({
			Items: [
				{
					url: "site.test/ok",
					originalUrl: "https://site.test/ok",
					crawlStatus: "ready",
					summaryStatus: "ready",
					savedAt: "2026-05-10T00:00:00.000Z",
				},
			],
			Count: 1,
		}));
		const failed = await collectFailedRows({
			client,
			tableName: TABLE,
			origin: ORIGIN,
			now: () => NOW,
			lookbackDays: 0,
			excludePatterns: NO_EXCLUDES,
		});
		assert.deepEqual(failed, []);
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
							crawlStatus: "failed",
							crawlFailureReason: "x",
							summaryStatus: "skipped",
							savedAt: "2026-05-10T00:00:00.000Z",
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
						crawlStatus: "ready",
						summaryStatus: "failed",
						summaryFailureReason: "y",
						savedAt: "2026-05-10T00:00:00.000Z",
					},
				],
				Count: 1,
			};
		});
		const failed = await collectFailedRows({
			client,
			tableName: TABLE,
			origin: ORIGIN,
			now: () => NOW,
			lookbackDays: 0,
			excludePatterns: NO_EXCLUDES,
		});
		assert.equal(calls.length, 2);
		assert.equal(calls[0]?.input.ExclusiveStartKey, undefined);
		assert.deepEqual(calls[1]?.input.ExclusiveStartKey, { url: "page1.test/a" });
		assert.equal(failed.length, 2);
	});

	it("falls back to url when originalUrl is missing (legacy rows)", async () => {
		const { client } = createFakeClient(() => ({
			Items: [
				{
					url: "legacy.test/x",
					crawlStatus: "failed",
					crawlFailureReason: "boom",
					summaryStatus: "skipped",
					savedAt: "2026-05-10T00:00:00.000Z",
				},
			],
			Count: 1,
		}));
		const failed = await collectFailedRows({
			client,
			tableName: TABLE,
			origin: ORIGIN,
			now: () => NOW,
			lookbackDays: 0,
			excludePatterns: NO_EXCLUDES,
		});
		assert.equal(failed.length, 1);
		assert.equal(failed[0]?.originalUrl, "legacy.test/x");
		assert.equal(
			failed[0]?.recrawlUrl,
			`${ORIGIN}/admin/recrawl/${encodeURIComponent("legacy.test/x")}`,
		);
	});

	it("filters out rows matched by the configured exclude patterns", async () => {
		const { client } = createFakeClient(() => ({
			Items: [
				{
					url: "excluded.test/a",
					originalUrl: "https://excluded.test/a",
					crawlStatus: "failed",
					crawlFailureReason: "x",
					summaryStatus: "skipped",
					savedAt: "2026-05-10T00:00:00.000Z",
				},
				{
					url: "kept.test/b",
					originalUrl: "https://kept.test/b",
					crawlStatus: "failed",
					crawlFailureReason: "y",
					summaryStatus: "skipped",
					savedAt: "2026-05-10T00:00:00.000Z",
				},
			],
			Count: 2,
		}));
		const failed = await collectFailedRows({
			client,
			tableName: TABLE,
			origin: ORIGIN,
			now: () => NOW,
			lookbackDays: 0,
			excludePatterns: [/:\/\/excluded\.test/],
		});
		assert.equal(failed.length, 1);
		assert.equal(failed[0]?.originalUrl, "https://kept.test/b");
	});
});
