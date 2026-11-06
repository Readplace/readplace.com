import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DynamoDBDocumentClient } from "@packages/storage-client";
import {
	CRAWL_STATUS_INDEX,
	SUMMARY_STATUS_INDEX,
} from "@packages/provider-contracts/article-status-indexes";
import {
	CRAWL_MIN_AGE_MS,
	SUMMARY_MIN_AGE_MS,
	buildQueryInputs,
	collectStuckRows,
} from "./collect-stuck-rows";

type SendFn = DynamoDBDocumentClient["send"];

interface QueryCommandLike {
	input: {
		TableName?: string;
		IndexName?: string;
		KeyConditionExpression?: string;
		FilterExpression?: string;
		ProjectionExpression?: string;
		ExpressionAttributeNames?: Record<string, string>;
		ExpressionAttributeValues?: Record<string, unknown>;
		ExclusiveStartKey?: Record<string, unknown>;
	};
}

interface QueryResultLike {
	Items?: Record<string, unknown>[];
	Count?: number;
	LastEvaluatedKey?: Record<string, unknown>;
}

type IndexName = typeof SUMMARY_STATUS_INDEX | typeof CRAWL_STATUS_INDEX;

function createFakeClient(
	impl: (input: QueryCommandLike) => QueryResultLike,
): { client: DynamoDBDocumentClient; calls: QueryCommandLike[] } {
	const calls: QueryCommandLike[] = [];
	const send = (async (command: QueryCommandLike) => {
		calls.push(command);
		return impl(command);
	}) as unknown as SendFn;
	const client = { send } as Partial<DynamoDBDocumentClient> as DynamoDBDocumentClient;
	return { client, calls };
}

function createIndexedFakeClient(rowsByIndex: Partial<Record<IndexName, Record<string, unknown>[]>>) {
	return createFakeClient((command) => {
		const index = command.input.IndexName;
		const rows =
			index === SUMMARY_STATUS_INDEX
				? rowsByIndex[SUMMARY_STATUS_INDEX]
				: index === CRAWL_STATUS_INDEX
					? rowsByIndex[CRAWL_STATUS_INDEX]
					: assert.fail(`unexpected IndexName ${String(index)}`);
		const items = rows ?? [];
		return { Items: items, Count: items.length };
	});
}

const NOW = new Date("2026-05-11T12:00:00.000Z");
const TABLE = "test-articles";
const OLD = new Date(NOW.getTime() - 30 * 60_000).toISOString();

const [summaryInput, crawlInput] = buildQueryInputs(NOW);

function placeholdersIn(...expressions: string[]): string[] {
	const found = new Set<string>();
	for (const expression of expressions) {
		for (const match of expression.matchAll(/:[A-Za-z]+/g)) found.add(match[0]);
	}
	return [...found].sort();
}

describe("buildQueryInputs", () => {
	it("queries the pending partition of each status index", () => {
		const inputs = buildQueryInputs(NOW);
		assert.deepEqual(
			inputs.map((input) => [input.IndexName, input.KeyConditionExpression]),
			[
				[SUMMARY_STATUS_INDEX, "summaryStatus = :pending"],
				[CRAWL_STATUS_INDEX, "crawlStatus = :pending"],
			],
		);
		for (const input of inputs) {
			assert.equal(input.ExpressionAttributeValues[":pending"], "pending");
		}
	});

	it("anchors the age-gate thresholds to (now - constant) per axis", () => {
		assert.equal(
			crawlInput.ExpressionAttributeValues[":crawlMinAge"],
			new Date(NOW.getTime() - CRAWL_MIN_AGE_MS).toISOString(),
		);
		assert.equal(
			summaryInput.ExpressionAttributeValues[":summaryMinAge"],
			new Date(NOW.getTime() - SUMMARY_MIN_AGE_MS).toISOString(),
		);
	});

	it("age-gates the crawl-pending query on crawlPendingSince with a legacy contentFetchedAt/savedAt fallback", () => {
		const filter = crawlInput.FilterExpression;
		assert.match(filter, /^crawlPendingSince < :crawlMinAge OR /);
		assert.match(
			filter,
			/attribute_not_exists\(crawlPendingSince\) AND attribute_not_exists\(summaryPendingSince\) AND \(contentFetchedAt < :crawlMinAge OR \(attribute_not_exists\(contentFetchedAt\) AND savedAt < :crawlMinAge\)\)/,
		);
	});

	it("age-gates the summary-pending query on summaryPendingSince with a legacy contentFetchedAt/savedAt fallback", () => {
		const filter = summaryInput.FilterExpression;
		assert.match(filter, /^summaryPendingSince < :summaryMinAge OR /);
		assert.match(
			filter,
			/attribute_not_exists\(crawlPendingSince\) AND attribute_not_exists\(summaryPendingSince\) AND \(contentFetchedAt < :summaryMinAge OR \(attribute_not_exists\(contentFetchedAt\) AND savedAt < :summaryMinAge\)\)/,
		);
	});

	it("only filters on pending age — no skipped, legacy-stub or writer-contract clauses", () => {
		for (const input of buildQueryInputs(NOW)) {
			assert.ok(!input.FilterExpression.includes("skipped"));
			assert.ok(!input.FilterExpression.includes("summarySkippedReason"));
			assert.ok(!input.FilterExpression.includes("attribute_not_exists(summaryStatus)"));
			assert.ok(!input.FilterExpression.includes(":ready"));
		}
	});

	it("holds exactly the placeholders each input's expressions reference (DynamoDB rejects unused values)", () => {
		for (const input of buildQueryInputs(NOW)) {
			assert.deepEqual(
				Object.keys(input.ExpressionAttributeValues).sort(),
				placeholdersIn(input.KeyConditionExpression, input.FilterExpression),
				`${input.IndexName} ExpressionAttributeValues must match its expressions`,
			);
		}
	});

	it("projects the pendingSince and legacy age attributes so the canary can diagnose age-gate decisions", () => {
		for (const input of buildQueryInputs(NOW)) {
			for (const attr of ["crawlPendingSince", "summaryPendingSince", "savedAt"]) {
				assert.ok(input.ProjectionExpression.includes(attr), `${attr} must be projected`);
			}
		}
	});

	it("aliases the reserved 'url' keyword via #u to keep ProjectionExpression valid", () => {
		for (const input of buildQueryInputs(NOW)) {
			assert.equal(input.ExpressionAttributeNames["#u"], "url");
			assert.match(input.ProjectionExpression, /#u/);
		}
	});
});

describe("collectStuckRows", () => {
	it("queries both status indexes on the configured table with the buildQueryInputs bodies, never a Scan", async () => {
		const { client, calls } = createIndexedFakeClient({});
		await collectStuckRows({
			client,
			tableName: TABLE,
			now: () => NOW,
		});
		assert.equal(calls.length, 2);
		const expected = buildQueryInputs(NOW);
		for (const [i, call] of calls.entries()) {
			assert.equal(call.constructor.name, "QueryCommand");
			assert.equal(call.input.TableName, TABLE);
			assert.ok(call.input.IndexName, "every call must name an index");
			assert.ok(call.input.KeyConditionExpression, "every call must carry a KeyConditionExpression");
			assert.equal(call.input.IndexName, expected[i]?.IndexName);
			assert.equal(call.input.KeyConditionExpression, expected[i]?.KeyConditionExpression);
			assert.equal(call.input.FilterExpression, expected[i]?.FilterExpression);
			assert.equal(call.input.ProjectionExpression, expected[i]?.ProjectionExpression);
			assert.deepEqual(call.input.ExpressionAttributeValues, expected[i]?.ExpressionAttributeValues);
		}
	});

	it("projects only the attributes the simplified pending check consumes", async () => {
		const { client, calls } = createIndexedFakeClient({});
		await collectStuckRows({
			client,
			tableName: TABLE,
			now: () => NOW,
		});
		for (const call of calls) {
			const projection = call.input.ProjectionExpression ?? "";
			for (const attr of [
				"originalUrl",
				"summaryStatus",
				"crawlStatus",
				"contentFetchedAt",
				"crawlPendingSince",
				"summaryPendingSince",
				"savedAt",
			]) {
				assert.ok(projection.includes(attr), `ProjectionExpression must include ${attr}`);
			}
			for (const attr of ["summaryFailureReason", "crawlFailureReason", "summarySkippedReason"]) {
				assert.ok(
					!projection.includes(attr),
					`ProjectionExpression must NOT include attribute ${attr}`,
				);
			}
			// `summary` (text) is a separate attribute from `summaryStatus`; match with a regex anchor.
			assert.ok(
				!/(^|[ ,])summary($|[ ,])/.test(projection),
				"ProjectionExpression must NOT include the legacy attribute 'summary'",
			);
			assert.equal(call.input.ExpressionAttributeNames?.["#u"], "url");
			assert.match(projection, /#u/);
		}
	});

	it("returns a stuck row for a crawl-pending row the crawl index surfaced", async () => {
		const { client } = createIndexedFakeClient({
			[CRAWL_STATUS_INDEX]: [
				{
					url: "example.test/article",
					originalUrl: "https://example.test/article",
					crawlStatus: "pending",
					summaryStatus: "ready",
					crawlPendingSince: OLD,
					savedAt: OLD,
				},
			],
		});
		const stuck = await collectStuckRows({
			client,
			tableName: TABLE,
			now: () => NOW,
		});
		assert.equal(stuck.length, 1);
		assert.equal(stuck[0]?.originalUrl, "https://example.test/article");
		assert.deepEqual(stuck[0]?.reasons, ["crawl-pending"]);
		assert.match(stuck[0]?.terminalCheckMessage ?? "", /crawlStatus is 'pending'/);
	});

	it("returns a stuck row for a summary-pending row the summary index surfaced", async () => {
		const { client } = createIndexedFakeClient({
			[SUMMARY_STATUS_INDEX]: [
				{
					url: "example.test/summary",
					originalUrl: "https://example.test/summary",
					crawlStatus: "ready",
					summaryStatus: "pending",
					summaryPendingSince: OLD,
					savedAt: OLD,
				},
			],
		});
		const stuck = await collectStuckRows({
			client,
			tableName: TABLE,
			now: () => NOW,
		});
		assert.equal(stuck.length, 1);
		assert.deepEqual(stuck[0]?.reasons, ["summary-pending"]);
	});

	it("reports a row pending on both axes once, although both indexes return it", async () => {
		const row = {
			url: "example.test/both",
			originalUrl: "https://example.test/both",
			crawlStatus: "pending",
			summaryStatus: "pending",
			crawlPendingSince: OLD,
			summaryPendingSince: OLD,
			savedAt: OLD,
		};
		const { client } = createIndexedFakeClient({
			[SUMMARY_STATUS_INDEX]: [row],
			[CRAWL_STATUS_INDEX]: [row],
		});
		const stuck = await collectStuckRows({
			client,
			tableName: TABLE,
			now: () => NOW,
		});
		assert.equal(stuck.length, 1);
		assert.equal(stuck[0]?.originalUrl, "https://example.test/both");
		assert.deepEqual(stuck[0]?.reasons, ["summary-pending", "crawl-pending"]);
	});

	it("skips terminal rows (a row may have left the pending partition by the time it is read)", async () => {
		const { client } = createIndexedFakeClient({
			[SUMMARY_STATUS_INDEX]: [
				{
					url: "example.test/done",
					originalUrl: "https://example.test/done",
					summaryStatus: "ready",
					crawlStatus: "ready",
					savedAt: OLD,
				},
			],
		});
		const stuck = await collectStuckRows({
			client,
			tableName: TABLE,
			now: () => NOW,
		});
		assert.deepEqual(stuck, []);
	});

	it("paginates within one index query: a LastEvaluatedKey triggers a second Query on the same index with ExclusiveStartKey", async () => {
		const { client, calls } = createFakeClient((command) => {
			if (command.input.IndexName === CRAWL_STATUS_INDEX) return { Items: [], Count: 0 };
			if (command.input.ExclusiveStartKey === undefined) {
				return {
					Items: [
						{
							url: "page1.test/a",
							originalUrl: "https://page1.test/a",
							summaryStatus: "pending",
							savedAt: OLD,
						},
					],
					Count: 1,
					LastEvaluatedKey: { url: "page1.test/a", summaryStatus: "pending" },
				};
			}
			return {
				Items: [
					{
						url: "page2.test/b",
						originalUrl: "https://page2.test/b",
						summaryStatus: "pending",
						savedAt: OLD,
					},
				],
				Count: 1,
			};
		});
		const stuck = await collectStuckRows({
			client,
			tableName: TABLE,
			now: () => NOW,
		});
		const summaryCalls = calls.filter((call) => call.input.IndexName === SUMMARY_STATUS_INDEX);
		assert.equal(summaryCalls.length, 2);
		assert.equal(summaryCalls[0]?.input.ExclusiveStartKey, undefined);
		assert.deepEqual(summaryCalls[1]?.input.ExclusiveStartKey, {
			url: "page1.test/a",
			summaryStatus: "pending",
		});
		assert.equal(calls.length, 3);
		assert.deepEqual(
			stuck.map((row) => row.originalUrl),
			["https://page1.test/a", "https://page2.test/b"],
		);
	});

	it("falls back to url when originalUrl is missing (legacy rows)", async () => {
		const { client } = createIndexedFakeClient({
			[CRAWL_STATUS_INDEX]: [
				{
					url: "example.test/legacy",
					crawlStatus: "pending",
					summaryStatus: "pending",
					savedAt: OLD,
				},
			],
		});
		const stuck = await collectStuckRows({
			client,
			tableName: TABLE,
			now: () => NOW,
		});
		assert.equal(stuck.length, 1);
		assert.equal(stuck[0]?.originalUrl, "example.test/legacy");
	});

	it("does NOT surface a summary.skipped('content-too-short') row (PR #320 tie path is the recovery; pure retry no-ops)", async () => {
		const { client } = createIndexedFakeClient({
			[CRAWL_STATUS_INDEX]: [
				{
					url: "example.test/stub-content",
					originalUrl: "https://example.test/stub-content",
					summaryStatus: "skipped",
					summarySkippedReason: "content-too-short",
					crawlStatus: "ready",
					contentFetchedAt: OLD,
					savedAt: OLD,
				},
			],
		});
		const stuck = await collectStuckRows({
			client,
			tableName: TABLE,
			now: () => NOW,
		});
		assert.deepEqual(stuck, []);
	});
});
