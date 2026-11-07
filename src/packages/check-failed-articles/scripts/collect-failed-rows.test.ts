import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	CRAWL_STATUS_INDEX,
	SUMMARY_STATUS_INDEX,
} from "@packages/provider-contracts/article-status-indexes";
import type { DynamoDBDocumentClient } from "@packages/storage-client";
import { buildQueryInputs, collectFailedRows } from "./collect-failed-rows";

type SendFn = DynamoDBDocumentClient["send"];

type Row = Record<string, unknown>;

interface QueryCommandLike {
	constructor: { name: string };
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
	Items?: Row[];
	Count?: number;
	LastEvaluatedKey?: Record<string, unknown>;
}

function createFakeClient(
	impl: (command: QueryCommandLike) => QueryResultLike,
): { client: DynamoDBDocumentClient; calls: QueryCommandLike[] } {
	const calls: QueryCommandLike[] = [];
	const send = (async (command: QueryCommandLike) => {
		calls.push(command);
		return impl(command);
	}) as unknown as SendFn;
	const client = { send } as Partial<DynamoDBDocumentClient> as DynamoDBDocumentClient;
	return { client, calls };
}

function createIndexClient(pagesByIndex: Partial<Record<string, Row[][]>>) {
	const served = new Map<string, number>();
	return createFakeClient((command) => {
		const index = String(command.input.IndexName);
		const pages = pagesByIndex[index] ?? [[]];
		const pageIndex = served.get(index) ?? 0;
		served.set(index, pageIndex + 1);
		const items = pages[pageIndex] ?? [];
		const hasNext = pageIndex + 1 < pages.length;
		return {
			Items: items,
			Count: items.length,
			LastEvaluatedKey: hasNext ? { url: `${index}-page-${pageIndex + 1}` } : undefined,
		};
	});
}

const NOW = new Date("2026-05-18T12:00:00.000Z");
const TABLE = "test-articles";
const NO_EXCLUDES: readonly RegExp[] = [];

function collect(client: DynamoDBDocumentClient, excludePatterns = NO_EXCLUDES) {
	return collectFailedRows({
		client,
		tableName: TABLE,
		now: () => NOW,
		lookbackDays: 0,
		excludePatterns,
	});
}

function placeholdersIn(expressions: (string | undefined)[], prefix: ":" | "#"): string[] {
	const pattern = prefix === ":" ? /:\w+/g : /#\w+/g;
	const found = new Set<string>();
	for (const expression of expressions) {
		for (const match of expression?.match(pattern) ?? []) found.add(match);
	}
	return [...found].sort();
}

describe("buildQueryInputs", () => {
	it("queries the failed partition of each status index — never a table scan", () => {
		const [crawl, summary] = buildQueryInputs(NOW, 0);
		assert.equal(crawl.IndexName, CRAWL_STATUS_INDEX);
		assert.equal(crawl.KeyConditionExpression, "crawlStatus = :failed");
		assert.equal(summary.IndexName, SUMMARY_STATUS_INDEX);
		assert.equal(summary.KeyConditionExpression, "summaryStatus = :failed");
		assert.equal(crawl.ExpressionAttributeValues[":failed"], "failed");
		assert.equal(summary.ExpressionAttributeValues[":failed"], "failed");
	});

	it("requires the other axis to be present and non-pending so only rows terminal on both axes are returned", () => {
		const [crawl, summary] = buildQueryInputs(NOW, 0);
		assert.match(
			crawl.FilterExpression,
			/attribute_exists\(summaryStatus\) AND summaryStatus <> :pending/,
		);
		assert.match(
			summary.FilterExpression,
			/attribute_exists\(crawlStatus\) AND crawlStatus <> :pending/,
		);
	});

	it("excludes a failed row whose metered legs were deferred to the reader, since the paid crawl never tried it", () => {
		for (const input of buildQueryInputs(NOW, 0)) {
			assert.match(input.FilterExpression, /AND attribute_not_exists\(meteredLegsDeferredSince\)/);
		}
	});

	it("never matches unsupported or summary-skipped — they are complete outcomes, not failures", () => {
		for (const input of buildQueryInputs(NOW, 0)) {
			const expressions = `${input.KeyConditionExpression} ${input.FilterExpression}`;
			assert.ok(!expressions.includes("unsupported"));
			assert.ok(!expressions.includes("skipped"));
			assert.ok(!Object.values(input.ExpressionAttributeValues).includes("unsupported"));
			assert.ok(!Object.values(input.ExpressionAttributeValues).includes("skipped"));
		}
	});

	it("omits the savedAt time gate from both filters when lookbackDays = 0 (operator wants full history)", () => {
		for (const input of buildQueryInputs(NOW, 0)) {
			assert.ok(
				!input.FilterExpression.includes("savedAt"),
				`expected no savedAt clause, got: ${input.FilterExpression}`,
			);
			assert.equal(input.ExpressionAttributeValues[":since"], undefined);
		}
	});

	it("anchors the savedAt time gate in both filters to (now - lookbackDays) when lookbackDays > 0", () => {
		const expected = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
		for (const input of buildQueryInputs(NOW, 7)) {
			assert.match(input.FilterExpression, /savedAt >= :since/);
			assert.equal(input.ExpressionAttributeValues[":since"], expected);
		}
	});

	it("gives each input exactly the value and name placeholders its own expressions reference (DynamoDB rejects unused ones)", () => {
		for (const lookbackDays of [0, 7]) {
			for (const input of buildQueryInputs(NOW, lookbackDays)) {
				const expressions = [
					input.KeyConditionExpression,
					input.FilterExpression,
					input.ProjectionExpression,
				];
				assert.deepEqual(
					Object.keys(input.ExpressionAttributeValues).sort(),
					placeholdersIn(expressions, ":"),
				);
				assert.deepEqual(
					Object.keys(input.ExpressionAttributeNames).sort(),
					placeholdersIn(expressions, "#"),
				);
			}
		}
	});

	it("rejects negative or non-integer lookbackDays values (caller bug)", () => {
		assert.throws(() => buildQueryInputs(NOW, -1), /non-negative integer/);
		assert.throws(() => buildQueryInputs(NOW, 1.5), /non-negative integer/);
	});

	it("projects the failure-reason attributes the canary actually reports on", () => {
		for (const input of buildQueryInputs(NOW, 0)) {
			for (const attr of [
				"originalUrl",
				"crawlStatus",
				"crawlFailureReason",
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
				!input.ProjectionExpression.includes("crawlUnsupportedReason"),
				"crawlUnsupportedReason is not surfaced — crawl-unsupported is a complete outcome",
			);
			assert.ok(
				!input.ProjectionExpression.includes("summarySkippedReason"),
				"summarySkippedReason is not surfaced — summary-skipped is a successful outcome",
			);
		}
	});

	it("aliases the reserved 'url' keyword via #u to keep ProjectionExpression valid", () => {
		for (const input of buildQueryInputs(NOW, 0)) {
			assert.equal(input.ExpressionAttributeNames["#u"], "url");
			assert.match(input.ProjectionExpression, /#u/);
		}
	});
});

describe("collectFailedRows", () => {
	it("issues one Query per status index against the configured table with the buildQueryInputs bodies", async () => {
		const { client, calls } = createIndexClient({});
		await collect(client);
		const expected = buildQueryInputs(NOW, 0);
		assert.equal(calls.length, 2);
		for (const [i, input] of expected.entries()) {
			const call = calls[i];
			assert.equal(call?.input.TableName, TABLE);
			assert.equal(call?.input.IndexName, input.IndexName);
			assert.equal(call?.input.KeyConditionExpression, input.KeyConditionExpression);
			assert.equal(call?.input.FilterExpression, input.FilterExpression);
			assert.equal(call?.input.ProjectionExpression, input.ProjectionExpression);
			assert.deepEqual(call?.input.ExpressionAttributeValues, input.ExpressionAttributeValues);
		}
	});

	it("never scans the table: every call is a Query carrying an IndexName and a KeyConditionExpression", async () => {
		const { client, calls } = createIndexClient({
			[CRAWL_STATUS_INDEX]: [[], []],
			[SUMMARY_STATUS_INDEX]: [[]],
		});
		await collect(client);
		assert.equal(calls.length, 3);
		for (const call of calls) {
			assert.equal(call.constructor.name, "QueryCommand");
			assert.ok(call.input.IndexName, "every call must name a status index");
			assert.ok(call.input.KeyConditionExpression, "every call must carry a key condition");
		}
		assert.deepEqual(
			[...new Set(calls.map((call) => call.input.IndexName))].sort(),
			[CRAWL_STATUS_INDEX, SUMMARY_STATUS_INDEX].sort(),
		);
	});

	it("reports a row failed on both axes once, though both indexes return it", async () => {
		const row = {
			url: "site.test/both",
			originalUrl: "https://site.test/both",
			crawlStatus: "failed",
			crawlFailureReason: '{"kind":"http-error","status":500}',
			summaryStatus: "failed",
			summaryFailureReason: '{"kind":"crawl-failed"}',
			savedAt: "2026-05-10T00:00:00.000Z",
		};
		const { client } = createIndexClient({
			[CRAWL_STATUS_INDEX]: [[row]],
			[SUMMARY_STATUS_INDEX]: [[row]],
		});
		const failed = await collect(client);
		assert.equal(failed.length, 1);
		assert.deepEqual(failed[0]?.axes, ["crawl-failed", "summary-failed"]);
	});

	it("classifies a crawl-failed row and surfaces its failure reason; summary-skipped is silently dropped", async () => {
		const { client } = createIndexClient({
			[CRAWL_STATUS_INDEX]: [
				[
					{
						url: "site.test/broken",
						originalUrl: "https://site.test/broken",
						crawlStatus: "failed",
						crawlFailureReason: '{"kind":"http-error","status":403}',
						summaryStatus: "skipped",
						savedAt: "2026-05-10T00:00:00.000Z",
					},
				],
			],
		});
		const failed = await collect(client);
		assert.equal(failed.length, 1);
		assert.equal(failed[0]?.originalUrl, "https://site.test/broken");
		assert.deepEqual(failed[0]?.axes, ["crawl-failed"]);
		assert.equal(failed[0]?.reasons["crawl-failed"], '{"kind":"http-error","status":403}');
	});

	it("drops a paid-crawl-budget spend-capped block — our own transient cap, not a debuggable failure", async () => {
		const { client } = createIndexClient({
			[CRAWL_STATUS_INDEX]: [
				[
					{
						url: "site.test/throttled",
						originalUrl: "https://site.test/throttled.pdf",
						crawlStatus: "failed",
						crawlFailureReason: '{"kind":"blocked","cause":"spend-capped"}',
						summaryStatus: "skipped",
						savedAt: "2026-05-10T00:00:00.000Z",
					},
				],
			],
		});
		assert.deepEqual(await collect(client), []);
	});

	it("surfaces an origin rate-limit — the site throttled us, which is a link we lost, unlike our own spend cap", async () => {
		const { client } = createIndexClient({
			[CRAWL_STATUS_INDEX]: [
				[
					{
						url: "site.test/429",
						originalUrl: "https://site.test/429",
						crawlStatus: "failed",
						crawlFailureReason: '{"kind":"blocked","cause":"rate-limited"}',
						summaryStatus: "skipped",
						savedAt: "2026-05-10T00:00:00.000Z",
					},
				],
			],
		});
		const failed = await collect(client);
		assert.equal(failed.length, 1);
		assert.deepEqual(failed[0]?.axes, ["crawl-failed"]);
	});

	it("drops a not-found crawl failure — the origin no longer serves the page, so a recrawl can never succeed", async () => {
		const { client } = createIndexClient({
			[CRAWL_STATUS_INDEX]: [
				[
					{
						url: "site.test/deleted",
						originalUrl: "https://site.test/deleted",
						crawlStatus: "failed",
						crawlFailureReason: '{"kind":"not-found","httpStatus":404}',
						summaryStatus: "skipped",
						savedAt: "2026-05-10T00:00:00.000Z",
					},
				],
			],
		});
		assert.deepEqual(await collect(client), []);
	});

	it("still surfaces the summary axis when a not-found crawl left the summary failed (pre-fix legacy rows)", async () => {
		const row = {
			url: "site.test/deleted-legacy",
			originalUrl: "https://site.test/deleted-legacy",
			crawlStatus: "failed",
			crawlFailureReason: '{"kind":"not-found","httpStatus":404}',
			summaryStatus: "failed",
			summaryFailureReason: '{"kind":"crawl-failed"}',
			savedAt: "2026-05-10T00:00:00.000Z",
		};
		const { client } = createIndexClient({
			[CRAWL_STATUS_INDEX]: [[row]],
			[SUMMARY_STATUS_INDEX]: [[row]],
		});
		const failed = await collect(client);
		assert.equal(failed.length, 1);
		assert.deepEqual(failed[0]?.axes, ["summary-failed"]);
	});

	it("surfaces a non-rate-limited block (edge-block) — a real crawler block to investigate", async () => {
		const { client } = createIndexClient({
			[CRAWL_STATUS_INDEX]: [
				[
					{
						url: "site.test/cf",
						originalUrl: "https://site.test/cf",
						crawlStatus: "failed",
						crawlFailureReason: '{"kind":"blocked","cause":"edge-block"}',
						summaryStatus: "skipped",
						savedAt: "2026-05-10T00:00:00.000Z",
					},
				],
			],
		});
		const failed = await collect(client);
		assert.equal(failed.length, 1);
		assert.deepEqual(failed[0]?.axes, ["crawl-failed"]);
		assert.equal(failed[0]?.reasons["crawl-failed"], '{"kind":"blocked","cause":"edge-block"}');
	});

	it("surfaces a valid non-blocked failure reason (parse-error) — only blocked/rate-limited is dropped", async () => {
		const { client } = createIndexClient({
			[CRAWL_STATUS_INDEX]: [
				[
					{
						url: "site.test/parse",
						originalUrl: "https://site.test/parse",
						crawlStatus: "failed",
						crawlFailureReason: '{"kind":"parse-error","detail":"Readability crashed"}',
						summaryStatus: "skipped",
						savedAt: "2026-05-10T00:00:00.000Z",
					},
				],
			],
		});
		const failed = await collect(client);
		assert.equal(failed.length, 1);
		assert.deepEqual(failed[0]?.axes, ["crawl-failed"]);
	});

	it("surfaces a crawl-failed row carrying no failure reason (legacy) rather than misreading it as a block", async () => {
		const { client } = createIndexClient({
			[CRAWL_STATUS_INDEX]: [
				[
					{
						url: "site.test/noreason",
						originalUrl: "https://site.test/noreason",
						crawlStatus: "failed",
						summaryStatus: "skipped",
						savedAt: "2026-05-10T00:00:00.000Z",
					},
				],
			],
		});
		const failed = await collect(client);
		assert.equal(failed.length, 1);
		assert.deepEqual(failed[0]?.axes, ["crawl-failed"]);
		assert.equal(failed[0]?.reasons["crawl-failed"], undefined);
	});

	it("drops a crawl-unsupported row — an unsupported content type is a complete, supported determination, not a failure", async () => {
		const { client } = createIndexClient({
			[CRAWL_STATUS_INDEX]: [
				[
					{
						url: "site.test/pdf",
						originalUrl: "https://site.test/paper.pdf",
						crawlStatus: "unsupported",
						summaryStatus: "skipped",
						savedAt: "2026-05-10T00:00:00.000Z",
					},
				],
			],
		});
		assert.deepEqual(await collect(client), []);
	});

	it("classifies a summary-only-failed row whose crawl succeeded", async () => {
		const { client } = createIndexClient({
			[SUMMARY_STATUS_INDEX]: [
				[
					{
						url: "site.test/long",
						originalUrl: "https://site.test/long",
						crawlStatus: "ready",
						summaryStatus: "failed",
						summaryFailureReason: '{"kind":"exhausted-retries","receiveCount":3}',
						savedAt: "2026-05-10T00:00:00.000Z",
					},
				],
			],
		});
		const failed = await collect(client);
		assert.equal(failed.length, 1);
		assert.deepEqual(failed[0]?.axes, ["summary-failed"]);
	});

	it("skips a row whose only non-ready axis is summary-skipped (now a success outcome)", async () => {
		const { client } = createIndexClient({
			[SUMMARY_STATUS_INDEX]: [
				[
					{
						url: "site.test/short",
						originalUrl: "https://site.test/short",
						crawlStatus: "ready",
						summaryStatus: "skipped",
						savedAt: "2026-05-10T00:00:00.000Z",
					},
				],
			],
		});
		assert.deepEqual(await collect(client), []);
	});

	it("skips fully ready rows should an index still return one", async () => {
		const { client } = createIndexClient({
			[CRAWL_STATUS_INDEX]: [
				[
					{
						url: "site.test/ok",
						originalUrl: "https://site.test/ok",
						crawlStatus: "ready",
						summaryStatus: "ready",
						savedAt: "2026-05-10T00:00:00.000Z",
					},
				],
			],
		});
		assert.deepEqual(await collect(client), []);
	});

	it("paginates within one index: a LastEvaluatedKey on page 1 triggers a second Query of that index with ExclusiveStartKey", async () => {
		const { client, calls } = createIndexClient({
			[CRAWL_STATUS_INDEX]: [
				[
					{
						url: "page1.test/a",
						originalUrl: "https://page1.test/a",
						crawlStatus: "failed",
						crawlFailureReason: "x",
						summaryStatus: "skipped",
						savedAt: "2026-05-10T00:00:00.000Z",
					},
				],
				[
					{
						url: "page2.test/b",
						originalUrl: "https://page2.test/b",
						crawlStatus: "failed",
						crawlFailureReason: "y",
						summaryStatus: "ready",
						savedAt: "2026-05-10T00:00:00.000Z",
					},
				],
			],
		});
		const failed = await collect(client);
		const crawlCalls = calls.filter((call) => call.input.IndexName === CRAWL_STATUS_INDEX);
		assert.equal(crawlCalls.length, 2);
		assert.equal(crawlCalls[0]?.input.ExclusiveStartKey, undefined);
		assert.deepEqual(crawlCalls[1]?.input.ExclusiveStartKey, {
			url: `${CRAWL_STATUS_INDEX}-page-1`,
		});
		const summaryCalls = calls.filter((call) => call.input.IndexName === SUMMARY_STATUS_INDEX);
		assert.equal(summaryCalls.length, 1);
		assert.equal(summaryCalls[0]?.input.ExclusiveStartKey, undefined);
		assert.deepEqual(
			failed.map((row) => row.originalUrl),
			["https://page1.test/a", "https://page2.test/b"],
		);
	});

	it("falls back to url when originalUrl is missing (legacy rows)", async () => {
		const { client } = createIndexClient({
			[CRAWL_STATUS_INDEX]: [
				[
					{
						url: "legacy.test/x",
						crawlStatus: "failed",
						crawlFailureReason: "boom",
						summaryStatus: "skipped",
						savedAt: "2026-05-10T00:00:00.000Z",
					},
				],
			],
		});
		const failed = await collect(client);
		assert.equal(failed.length, 1);
		assert.equal(failed[0]?.originalUrl, "legacy.test/x");
	});

	it("filters out rows matched by the configured exclude patterns", async () => {
		const { client } = createIndexClient({
			[CRAWL_STATUS_INDEX]: [
				[
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
			],
		});
		const failed = await collect(client, [/:\/\/excluded\.test/]);
		assert.equal(failed.length, 1);
		assert.equal(failed[0]?.originalUrl, "https://kept.test/b");
	});
});
