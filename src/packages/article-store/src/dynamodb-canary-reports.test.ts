import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { type CanaryReportRow, CanaryReportSourceSchema } from "@packages/provider-contracts/canary-report";
import { initDynamoDbCanaryReports } from "./dynamodb-canary-reports";

type SendFn = DynamoDBDocumentClient["send"];

interface SentCommand {
	name: string;
	input: Record<string, unknown>;
}

function fakeClient(answer: (command: SentCommand) => Promise<unknown>): {
	client: Pick<DynamoDBDocumentClient, "send">;
	sent: SentCommand[];
} {
	const sent: SentCommand[] = [];
	const send = async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
		const captured = { name: command.constructor.name, input: command.input };
		sent.push(captured);
		return answer(captured);
	};
	return { client: { send: send as unknown as SendFn }, sent };
}

const TABLE = "canary-reports";

function failedRow(n: number): CanaryReportRow {
	return {
		url: `https://site.test/post-${n}`,
		labels: ["crawl-failed"],
		detail: "crawl-failed: {\"kind\":\"exhausted-retries\",\"receiveCount\":3}",
		savedAt: undefined,
		contentFetchedAt: undefined,
	};
}

describe("initDynamoDbCanaryReports", () => {
	describe("saveCanaryReport", () => {
		it("stores each row as one item under the report's id, numbered from 1, with the run on every item", async () => {
			const { client, sent } = fakeClient(async () => ({}));
			const { saveCanaryReport } = initDynamoDbCanaryReports({ client, tableName: TABLE });

			await saveCanaryReport({
				canary: "failed-articles",
				source: CanaryReportSourceSchema.parse("run-37967705297-2"),
				runUrl: "https://github.test/actions/runs/37967705297",
				createdAt: "2026-10-10T20:00:05.000Z",
				rows: [
					{
						url: "https://site.test/post?ref=feed&id=7",
						labels: ["crawl-failed", "summary-failed"],
						detail: "crawl-failed: {\"kind\":\"blocked\",\"cause\":\"edge-block\"} | summary-failed: {\"kind\":\"crawl-failed\"}",
						savedAt: "2026-10-01T08:00:00.000Z",
						contentFetchedAt: "2026-10-02T09:30:00.000Z",
					},
					{
						url: "chrome://newtab/",
						labels: ["crawl-failed"],
						detail: "(no stored reason)",
						savedAt: undefined,
						contentFetchedAt: undefined,
					},
				],
			});

			expect(sent).toStrictEqual([
				{
					name: "PutCommand",
					input: {
						TableName: TABLE,
						Item: {
							reportId: "failed-articles/run-37967705297-2",
							rowIndex: 1,
							runUrl: "https://github.test/actions/runs/37967705297",
							createdAt: "2026-10-10T20:00:05.000Z",
							url: "https://site.test/post?ref=feed&id=7",
							labels: ["crawl-failed", "summary-failed"],
							detail: "crawl-failed: {\"kind\":\"blocked\",\"cause\":\"edge-block\"} | summary-failed: {\"kind\":\"crawl-failed\"}",
							savedAt: "2026-10-01T08:00:00.000Z",
							contentFetchedAt: "2026-10-02T09:30:00.000Z",
						},
					},
				},
				{
					name: "PutCommand",
					input: {
						TableName: TABLE,
						Item: {
							reportId: "failed-articles/run-37967705297-2",
							rowIndex: 2,
							runUrl: "https://github.test/actions/runs/37967705297",
							createdAt: "2026-10-10T20:00:05.000Z",
							url: "chrome://newtab/",
							labels: ["crawl-failed"],
							detail: "(no stored reason)",
						},
					},
				},
			]);
		});

		it("keeps at most 25 puts in flight while it writes every row", async () => {
			let inFlight = 0;
			let peak = 0;
			const { client, sent } = fakeClient(async () => {
				inFlight += 1;
				peak = Math.max(peak, inFlight);
				await new Promise((resolve) => setImmediate(resolve));
				inFlight -= 1;
				return {};
			});
			const { saveCanaryReport } = initDynamoDbCanaryReports({ client, tableName: TABLE });

			await saveCanaryReport({
				canary: "failed-articles",
				source: CanaryReportSourceSchema.parse("run-12-1"),
				runUrl: "https://github.test/actions/runs/12",
				createdAt: "2026-10-10T20:00:05.000Z",
				rows: [failedRow(1), ...Array.from({ length: 25 }, (_, index) => failedRow(index + 2))],
			});

			expect({ peak, sent: sent.length }).toEqual({ peak: 25, sent: 26 });
		});
	});

	describe("findCanaryReport", () => {
		it("reads a report back across query pages in row order, leaving absent times undefined", async () => {
			const pages = [
				{
					Items: [
						{
							reportId: "stuck-articles/issue-226-comment-4366291266",
							rowIndex: 1,
							runUrl: "https://github.test/actions/runs/226",
							createdAt: "2026-06-01T19:31:00.000Z",
							url: "https://site.test/stuck",
							labels: ["summary-pending", "crawl-pending"],
							detail: "crawlStatus is 'pending'",
							savedAt: "2026-05-30T10:00:00.000Z",
							contentFetchedAt: "2026-05-31T11:00:00.000Z",
						},
					],
					LastEvaluatedKey: { reportId: "stuck-articles/issue-226-comment-4366291266", rowIndex: 1 },
				},
				{
					Items: [
						{
							reportId: "stuck-articles/issue-226-comment-4366291266",
							rowIndex: 2,
							runUrl: "https://github.test/actions/runs/226",
							createdAt: "2026-06-01T19:31:00.000Z",
							url: "legacy.test/stuck",
							labels: ["summary-skipped-ai-unavailable"],
							detail: "summaryStatus is 'skipped'",
						},
					],
				},
			];
			const { client, sent } = fakeClient(async () => pages.shift());
			const { findCanaryReport } = initDynamoDbCanaryReports({ client, tableName: TABLE });
			const source = CanaryReportSourceSchema.parse("issue-226-comment-4366291266");

			const report = await findCanaryReport({ canary: "stuck-articles", source });

			expect(report).toStrictEqual({
				canary: "stuck-articles",
				source,
				runUrl: "https://github.test/actions/runs/226",
				createdAt: "2026-06-01T19:31:00.000Z",
				rows: [
					{
						url: "https://site.test/stuck",
						labels: ["summary-pending", "crawl-pending"],
						detail: "crawlStatus is 'pending'",
						savedAt: "2026-05-30T10:00:00.000Z",
						contentFetchedAt: "2026-05-31T11:00:00.000Z",
					},
					{
						url: "legacy.test/stuck",
						labels: ["summary-skipped-ai-unavailable"],
						detail: "summaryStatus is 'skipped'",
						savedAt: undefined,
						contentFetchedAt: undefined,
					},
				],
			});
			expect(sent.map((command) => [command.name, command.input])).toEqual([
				[
					"QueryCommand",
					{
						TableName: TABLE,
						KeyConditionExpression: "reportId = :reportId",
						ExpressionAttributeValues: { ":reportId": "stuck-articles/issue-226-comment-4366291266" },
					},
				],
				[
					"QueryCommand",
					{
						TableName: TABLE,
						KeyConditionExpression: "reportId = :reportId",
						ExpressionAttributeValues: { ":reportId": "stuck-articles/issue-226-comment-4366291266" },
						ExclusiveStartKey: { reportId: "stuck-articles/issue-226-comment-4366291266", rowIndex: 1 },
					},
				],
			]);
		});

		it("finds no report when nothing is stored under the key", async () => {
			const { client } = fakeClient(async () => ({ Items: [] }));
			const { findCanaryReport } = initDynamoDbCanaryReports({ client, tableName: TABLE });

			const report = await findCanaryReport({
				canary: "failed-articles",
				source: CanaryReportSourceSchema.parse("issue-1197"),
			});

			expect(report).toBeUndefined();
		});
	});
});
