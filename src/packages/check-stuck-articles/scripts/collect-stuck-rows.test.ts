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

	it("age-gates the crawl-pending disjunct on crawlPendingSince with a legacy contentFetchedAt/savedAt fallback", () => {
		const input = buildScanInput(NOW);
		assert.match(
			input.FilterExpression,
			/crawlStatus = :pending AND \(crawlPendingSince < :crawlMinAge OR/,
		);
		assert.match(
			input.FilterExpression,
			/attribute_not_exists\(crawlPendingSince\) AND attribute_not_exists\(summaryPendingSince\)/,
		);
	});

	it("age-gates the summary-pending disjunct on summaryPendingSince with a legacy contentFetchedAt/savedAt fallback", () => {
		const input = buildScanInput(NOW);
		assert.match(
			input.FilterExpression,
			/summaryStatus = :pending AND \(summaryPendingSince < :summaryMinAge OR/,
		);
	});

	it("emits a skipped-ai-unavailable disjunct gated on contentFetchedAt (summary axis has no pendingSince once skipped)", () => {
		const input = buildScanInput(NOW);
		assert.match(
			input.FilterExpression,
			/summaryStatus = :skipped AND summarySkippedReason = :aiUnavailable AND \(contentFetchedAt < :summaryMinAge OR \(attribute_not_exists\(contentFetchedAt\) AND savedAt < :summaryMinAge\)\)/,
		);
		assert.equal(input.ExpressionAttributeValues[":skipped"], "skipped");
		assert.equal(input.ExpressionAttributeValues[":aiUnavailable"], "ai-unavailable");
	});

	it("only emits the pending and ai-unavailable disjuncts — no legacy-stub or writer-contract clauses", () => {
		const input = buildScanInput(NOW);
		assert.ok(
			!input.FilterExpression.includes("attribute_not_exists(summaryStatus)"),
			"legacy-stub disjunct must not appear in the simplified filter",
		);
		assert.ok(
			!input.FilterExpression.includes(":ready"),
			"writer-contract (summaryStatus = ready AND missing summary) disjunct must not appear",
		);
	});

	it("projects crawlPendingSince and summaryPendingSince so the canary can diagnose age-gate decisions", () => {
		const input = buildScanInput(NOW);
		assert.ok(
			input.ProjectionExpression.includes("crawlPendingSince"),
			"crawlPendingSince must be projected",
		);
		assert.ok(
			input.ProjectionExpression.includes("summaryPendingSince"),
			"summaryPendingSince must be projected",
		);
		assert.ok(
			input.ProjectionExpression.includes("savedAt"),
			"savedAt remains projected for the legacy fallback diagnostics",
		);
		assert.ok(
			input.ProjectionExpression.includes("summarySkippedReason"),
			"summarySkippedReason must be projected so the classifier can distinguish ai-unavailable from other skip reasons",
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

	it("projects only the attributes the simplified pending check consumes", async () => {
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
			"contentFetchedAt",
			"crawlPendingSince",
			"summaryPendingSince",
			"savedAt",
			"aggregateTransitionName",
			"summarySkippedReason",
		]) {
			assert.ok(projection.includes(attr), `ProjectionExpression must include ${attr}`);
		}
		for (const attr of ["summaryFailureReason", "crawlFailureReason"]) {
			assert.ok(
				!projection.includes(attr),
				`ProjectionExpression must NOT include legacy attribute ${attr}`,
			);
		}
		// `summary` (text) is a separate attribute from `summaryStatus`; match with a regex anchor.
		assert.ok(
			!/(^|[ ,])summary($|[ ,])/.test(projection),
			"ProjectionExpression must NOT include the legacy attribute 'summary'",
		);
		assert.equal(calls[0]?.input.ExpressionAttributeNames?.["#u"], "url");
		assert.match(projection, /#u/);
	});

	it("returns a stuck row for a crawl-pending row that DDB surfaced (with crawlPendingSince older than the gate)", async () => {
		const { client } = createFakeClient(() => ({
			Items: [
				{
					url: "example.test/article",
					originalUrl: "https://example.test/article",
					crawlStatus: "pending",
					summaryStatus: "pending",
					crawlPendingSince: new Date(NOW.getTime() - 30 * 60_000).toISOString(),
					summaryPendingSince: new Date(NOW.getTime() - 30 * 60_000).toISOString(),
					savedAt: new Date(NOW.getTime() - 30 * 60_000).toISOString(),
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
		assert.deepEqual(stuck[0]?.reasons, ["summary-pending", "crawl-pending"]);
		assert.equal(
			stuck[0]?.recrawlUrl,
			`${ORIGIN}/admin/recrawl/${encodeURIComponent("https://example.test/article")}`,
		);
		assert.match(stuck[0]?.terminalCheckMessage ?? "", /crawlStatus is 'pending'/);
	});

	it("skips terminal rows (DDB may still surface them when paginating)", async () => {
		const { client } = createFakeClient(() => ({
			Items: [
				{
					url: "example.test/done",
					originalUrl: "https://example.test/done",
					summaryStatus: "ready",
					crawlStatus: "ready",
					savedAt: new Date(NOW.getTime() - 30 * 60_000).toISOString(),
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
							savedAt: new Date(NOW.getTime() - 30 * 60_000).toISOString(),
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
						savedAt: new Date(NOW.getTime() - 30 * 60_000).toISOString(),
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

	it("falls back to url when originalUrl is missing (legacy rows)", async () => {
		const { client } = createFakeClient(() => ({
			Items: [
				{
					url: "example.test/legacy",
					crawlStatus: "pending",
					summaryStatus: "pending",
					savedAt: new Date(NOW.getTime() - 30 * 60_000).toISOString(),
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
		assert.equal(stuck[0]?.originalUrl, "example.test/legacy");
		assert.equal(
			stuck[0]?.recrawlUrl,
			`${ORIGIN}/admin/recrawl/${encodeURIComponent("example.test/legacy")}`,
		);
	});

	it("buckets stuck rows produced by Phase 2 migrated transitions under the -after-aggregate-migration variant (falsifiable measurement)", async () => {
		const { client } = createFakeClient(() => ({
			Items: [
				{
					url: "example.test/migrated-but-stuck",
					originalUrl: "https://example.test/migrated-but-stuck",
					crawlStatus: "pending",
					savedAt: new Date(NOW.getTime() - 30 * 60_000).toISOString(),
					aggregateTransitionName: "recrawlTieKeptCanonical",
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
		assert.deepEqual(stuck[0]?.reasons, [
			"crawl-pending-after-aggregate-migration",
		]);
	});

	it("surfaces a summary.skipped('ai-unavailable') row as summary-skipped-ai-unavailable (the AI was down, manual recrawl needed)", async () => {
		const { client } = createFakeClient(() => ({
			Items: [
				{
					url: "example.test/ai-was-down",
					originalUrl: "https://example.test/ai-was-down",
					summaryStatus: "skipped",
					summarySkippedReason: "ai-unavailable",
					crawlStatus: "ready",
					contentFetchedAt: new Date(NOW.getTime() - 30 * 60_000).toISOString(),
					savedAt: new Date(NOW.getTime() - 30 * 60_000).toISOString(),
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
		assert.deepEqual(stuck[0]?.reasons, ["summary-skipped-ai-unavailable"]);
		assert.match(stuck[0]?.terminalCheckMessage ?? "", /ai-unavailable/);
	});

	it("does NOT surface a summary.skipped('content-too-short') row (PR #320 tie path is the recovery; pure retry no-ops)", async () => {
		const { client } = createFakeClient(() => ({
			Items: [
				{
					url: "example.test/stub-content",
					originalUrl: "https://example.test/stub-content",
					summaryStatus: "skipped",
					summarySkippedReason: "content-too-short",
					crawlStatus: "ready",
					contentFetchedAt: new Date(NOW.getTime() - 30 * 60_000).toISOString(),
					savedAt: new Date(NOW.getTime() - 30 * 60_000).toISOString(),
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
});
