import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
} from "@packages/hutch-storage-client";
import { initDynamoDbGeneratedSummary } from "./dynamodb-generated-summary";

type SendFn = DynamoDBDocumentClient["send"];

function createFakeClient(impl: (input: unknown) => unknown): Partial<DynamoDBDocumentClient> {
	return {
		send: (async (input: unknown) => impl(input)) as unknown as SendFn,
	};
}

const TABLE = "test-articles";
const URL = "https://example.com/article";

function clientForGet(item: Record<string, unknown> | undefined): Partial<DynamoDBDocumentClient> {
	return createFakeClient(() => ({ Item: item }));
}

describe("initDynamoDbGeneratedSummary (unit)", () => {
	describe("findGeneratedSummary", () => {
		it("returns undefined when no row exists", async () => {
			const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
				client: clientForGet(undefined) as DynamoDBDocumentClient,
				tableName: TABLE,
			});
			expect(await findGeneratedSummary(URL)).toBeUndefined();
		});

		it("returns pending when status=pending", async () => {
			const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
				client: clientForGet({ summaryStatus: "pending" }) as DynamoDBDocumentClient,
				tableName: TABLE,
			});
			expect(await findGeneratedSummary(URL)).toEqual({ status: "pending" });
		});

		it("returns ready with summary only when summaryExcerpt is absent", async () => {
			const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
				client: clientForGet({ summaryStatus: "ready", summary: "done" }) as DynamoDBDocumentClient,
				tableName: TABLE,
			});
			expect(await findGeneratedSummary(URL)).toEqual({ status: "ready", summary: "done" });
		});

		it("returns ready with both summary and excerpt when summaryStatus is set and excerpt is present", async () => {
			// Why this matters: covers the explicit summaryStatus="ready"
			// branch with the excerpt-truthy sub-branch — the path the
			// production summariser hits on every fresh save once
			// `saveGeneratedSummary` writes summary, summaryExcerpt and
			// summaryStatus together. Without this test the new ready branch's
			// `if (row.summaryExcerpt)` true side stays uncovered and the
			// 100% branch threshold trips.
			const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
				client: clientForGet({
					summaryStatus: "ready",
					summary: "done",
					summaryExcerpt: "blurb",
				}) as DynamoDBDocumentClient,
				tableName: TABLE,
			});
			expect(await findGeneratedSummary(URL)).toEqual({
				status: "ready",
				summary: "done",
				excerpt: "blurb",
			});
		});

		it("throws when summaryStatus=ready is persisted without summary text (data inconsistency)", async () => {
			// Why this matters: this is the exact state the
			// fagnerbrack.com/why-developers-become-frustrated-… row was left in
			// after the 2026-05-10 freshness refresh ran an UpdateExpression that
			// REMOVEd `summary` without resetting `summaryStatus`. With the
			// previous code path the mapper silently returned undefined and the
			// reader UI rendered "Generating summary…" forever. The explicit
			// assert turns that silent stuck-pending state into a loud error
			// the moment any future writer reintroduces the same inconsistency.
			const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
				client: clientForGet({ summaryStatus: "ready" }) as DynamoDBDocumentClient,
				tableName: TABLE,
			});
			await expect(findGeneratedSummary(URL)).rejects.toThrow(
				"summaryStatus=ready row must carry a summary",
			);
		});

		it("returns failed with reason when status=failed", async () => {
			const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
				client: clientForGet({
					summaryStatus: "failed",
					summaryFailureReason: "deepseek timeout",
				}) as DynamoDBDocumentClient,
				tableName: TABLE,
			});
			expect(await findGeneratedSummary(URL)).toEqual({
				status: "failed",
				reason: "deepseek timeout",
			});
		});

		it("returns skipped without reason when status=skipped and no skip reason persisted", async () => {
			const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
				client: clientForGet({ summaryStatus: "skipped" }) as DynamoDBDocumentClient,
				tableName: TABLE,
			});
			expect(await findGeneratedSummary(URL)).toEqual({ status: "skipped" });
		});

		it("returns skipped with reason when summarySkippedReason is present", async () => {
			const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
				client: clientForGet({
					summaryStatus: "skipped",
					summarySkippedReason: "content-too-short",
				}) as DynamoDBDocumentClient,
				tableName: TABLE,
			});
			expect(await findGeneratedSummary(URL)).toEqual({
				status: "skipped",
				reason: "content-too-short",
			});
		});

		it("returns ready for a legacy row (summary present, no status)", async () => {
			const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
				client: clientForGet({ summary: "legacy" }) as DynamoDBDocumentClient,
				tableName: TABLE,
			});
			expect(await findGeneratedSummary(URL)).toEqual({ status: "ready", summary: "legacy" });
		});

		it("returns undefined for a legacy row that has neither summaryStatus nor summary", async () => {
			// Legacy rows pre-date the summary state machine. Return undefined so
			// the caller (summariser or view handler) can treat the row as
			// untouched and re-prime the pipeline instead of treating it as
			// actively pending.
			const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
				client: clientForGet({}) as DynamoDBDocumentClient,
				tableName: TABLE,
			});
			expect(await findGeneratedSummary(URL)).toBeUndefined();
		});
	});

	describe("saveGeneratedSummary", () => {
		it("issues an UpdateItem that sets summary and status=ready", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const { saveGeneratedSummary } = initDynamoDbGeneratedSummary({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			await saveGeneratedSummary({ url: URL, summary: "done", excerpt: "blurb", inputTokens: 1, outputTokens: 2 });

			expect(received).toBeDefined();
		});
	});

	describe("markSummaryStage", () => {
		it("issues an unconditional UpdateItem that sets summaryStage", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const { markSummaryStage } = initDynamoDbGeneratedSummary({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			await markSummaryStage({ url: URL, stage: "summary-generating" });

			const command = received as {
				input: {
					UpdateExpression?: string;
					ConditionExpression?: string;
					ExpressionAttributeValues?: Record<string, unknown>;
				};
			};
			expect(command.input.UpdateExpression).toBe("SET summaryStage = :stage");
			expect(command.input.ConditionExpression).toBeUndefined();
			expect(command.input.ExpressionAttributeValues?.[":stage"]).toBe(
				"summary-generating",
			);
		});
	});

	describe("mark functions — error handling", () => {
		it("swallows ConditionalCheckFailedException (ready row preserved)", async () => {
			const client = createFakeClient(() => {
				throw new ConditionalCheckFailedException({
					$metadata: {},
					message: "condition failed",
				});
			});
			const { markSummaryPending, markSummaryFailed, markSummarySkipped } =
				initDynamoDbGeneratedSummary({
					client: client as DynamoDBDocumentClient,
					tableName: TABLE,
				});

			await expect(markSummaryPending({ url: URL })).resolves.toBeUndefined();
			await expect(markSummaryFailed({ url: URL, reason: "r" })).resolves.toBeUndefined();
			await expect(
				markSummarySkipped({ url: URL, reason: "content-too-short" }),
			).resolves.toBeUndefined();
		});

		it("rethrows non-ConditionalCheck errors", async () => {
			const client = createFakeClient(() => {
				throw new Error("throttled");
			});
			const { markSummaryPending, markSummaryFailed, markSummarySkipped } =
				initDynamoDbGeneratedSummary({
					client: client as DynamoDBDocumentClient,
					tableName: TABLE,
				});

			await expect(markSummaryPending({ url: URL })).rejects.toThrow("throttled");
			await expect(markSummaryFailed({ url: URL, reason: "r" })).rejects.toThrow("throttled");
			await expect(
				markSummarySkipped({ url: URL, reason: "content-too-short" }),
			).rejects.toThrow("throttled");
		});
	});
});
