import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
} from "@packages/hutch-storage-client";
import { initDynamoDbGeneratedSummary } from "./dynamodb-generated-summary";

type SendFn = DynamoDBDocumentClient["send"];

function createSendingClient(
	impl: (input: unknown) => unknown,
): DynamoDBDocumentClient {
	return {
		send: (async (input: unknown) => impl(input)) as unknown as SendFn,
	} as Partial<DynamoDBDocumentClient> as DynamoDBDocumentClient;
}

const createFakeClient = (
	item: Record<string, unknown> | undefined,
): DynamoDBDocumentClient => createSendingClient(() => ({ Item: item }));

describe("initDynamoDbGeneratedSummary", () => {
	it("returns undefined when no row exists", async () => {
		const client = createFakeClient(undefined);
		const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
			client,
			tableName: "test-table",
		});

		const result = await findGeneratedSummary("https://example.com/article");

		expect(result).toBeUndefined();
	});

	it("returns undefined for a legacy row that has neither summaryStatus nor summary", async () => {
		// Legacy rows pre-date the summary state machine. The summaryStatus column
		// is absent and no backfilled summary column exists. Return undefined so
		// the caller can distinguish a stuck stub from an actively-pending row and
		// re-prime the pipeline rather than polling forever.
		const client = createFakeClient({ url: "https://example.com/article" });
		const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
			client,
			tableName: "test-table",
		});

		const result = await findGeneratedSummary("https://example.com/article");

		expect(result).toBeUndefined();
	});

	it("returns ready for a legacy row with summary and no status (backfill)", async () => {
		const client = createFakeClient({
			url: "https://example.com/article",
			summary: "Legacy summary",
		});
		const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
			client,
			tableName: "test-table",
		});

		const result = await findGeneratedSummary("https://example.com/article");

		expect(result).toEqual({ status: "ready", summary: "Legacy summary" });
	});

	it("returns ready with summary only when summaryExcerpt is absent", async () => {
		const client = createFakeClient({
			url: "https://example.com/article",
			summary: "Fresh summary",
			summaryStatus: "ready",
		});
		const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
			client,
			tableName: "test-table",
		});

		const result = await findGeneratedSummary("https://example.com/article");

		expect(result).toEqual({ status: "ready", summary: "Fresh summary" });
	});

	it("throws when summaryStatus=ready is persisted without summary text (data inconsistency)", async () => {
		// Why this matters: this is the exact state the
		// fagnerbrack.com/why-developers-become-frustrated-… row was left in
		// after the 2026-05-10 freshness refresh ran an UpdateExpression that
		// REMOVEd `summary` without resetting `summaryStatus`. With the previous
		// code path the mapper silently returned undefined, the reader UI
		// rendered "Generating summary…" and polled `/view/summary` every 3s
		// forever. The explicit assert turns that silent stuck-pending state
		// into a loud 500 the moment any future writer reintroduces the same
		// inconsistency, and keeps the consumer honest about the writer
		// contract: status=ready ⇒ summary text MUST be present.
		const client = createFakeClient({
			url: "https://example.com/article",
			summaryStatus: "ready",
		});
		const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
			client,
			tableName: "test-table",
		});

		await expect(findGeneratedSummary("https://example.com/article")).rejects.toThrow(
			"summaryStatus=ready row must carry a summary",
		);
	});

	it("returns ready with both summary and excerpt when summaryExcerpt is present", async () => {
		const client = createFakeClient({
			url: "https://example.com/article",
			summary: "Fresh summary",
			summaryExcerpt: "Decision-helper blurb",
			summaryStatus: "ready",
		});
		const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
			client,
			tableName: "test-table",
		});

		const result = await findGeneratedSummary("https://example.com/article");

		expect(result).toEqual({
			status: "ready",
			summary: "Fresh summary",
			excerpt: "Decision-helper blurb",
		});
	});

	it("returns pending when status=pending", async () => {
		const client = createFakeClient({
			url: "https://example.com/article",
			summaryStatus: "pending",
		});
		const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
			client,
			tableName: "test-table",
		});

		const result = await findGeneratedSummary("https://example.com/article");

		expect(result).toEqual({ status: "pending" });
	});

	it("returns pending with stage when summaryStage is recorded", async () => {
		const client = createFakeClient({
			url: "https://example.com/article",
			summaryStatus: "pending",
			summaryStage: "summary-generating",
		});
		const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
			client,
			tableName: "test-table",
		});

		const result = await findGeneratedSummary("https://example.com/article");

		expect(result).toEqual({ status: "pending", stage: "summary-generating" });
	});

	it("returns failed with reason when status=failed", async () => {
		const client = createFakeClient({
			url: "https://example.com/article",
			summaryStatus: "failed",
			summaryFailureReason: "deepseek timeout",
		});
		const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
			client,
			tableName: "test-table",
		});

		const result = await findGeneratedSummary("https://example.com/article");

		expect(result).toEqual({ status: "failed", reason: "deepseek timeout" });
	});

	it("throws when summaryStatus=failed is persisted without a summaryFailureReason", async () => {
		const client = createFakeClient({
			url: "https://example.com/article",
			summaryStatus: "failed",
		});
		const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
			client,
			tableName: "test-table",
		});

		await expect(findGeneratedSummary("https://example.com/article")).rejects.toThrow(
			"summaryStatus=failed row must carry a summaryFailureReason",
		);
	});

	it("returns skipped without reason when status=skipped and no reason persisted", async () => {
		const client = createFakeClient({
			url: "https://example.com/article",
			summaryStatus: "skipped",
		});
		const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
			client,
			tableName: "test-table",
		});

		const result = await findGeneratedSummary("https://example.com/article");

		expect(result).toEqual({ status: "skipped" });
	});

	it("returns skipped with reason when summarySkippedReason is present", async () => {
		const client = createFakeClient({
			url: "https://example.com/article",
			summaryStatus: "skipped",
			summarySkippedReason: "content-too-short",
		});
		const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
			client,
			tableName: "test-table",
		});

		const result = await findGeneratedSummary("https://example.com/article");

		expect(result).toEqual({ status: "skipped", reason: "content-too-short" });
	});

	describe("markSummaryPending", () => {
		it("issues an UpdateItem that sets summaryStatus=pending with a guard against ready rows", async () => {
			let received: unknown;
			const client = createSendingClient((input) => {
				received = input;
				return {};
			});
			const { markSummaryPending } = initDynamoDbGeneratedSummary({
				client,
				tableName: "test-table",
			});

			await markSummaryPending({ url: "https://example.com/article" });

			const command = received as {
				input: {
					UpdateExpression?: string;
					ConditionExpression?: string;
					ExpressionAttributeValues?: Record<string, unknown>;
				};
			};
			expect(command.input.UpdateExpression).toContain(
				"SET summaryStatus = :pending",
			);
			expect(command.input.ConditionExpression).toContain(
				"attribute_not_exists(summaryStatus) OR summaryStatus <> :ready",
			);
			expect(command.input.ExpressionAttributeValues?.[":pending"]).toBe(
				"pending",
			);
			expect(command.input.ExpressionAttributeValues?.[":ready"]).toBe("ready");
		});

		it("swallows ConditionalCheckFailedException so ready rows stay ready", async () => {
			const client = createSendingClient(() => {
				throw new ConditionalCheckFailedException({
					$metadata: {},
					message: "condition failed",
				});
			});
			const { markSummaryPending } = initDynamoDbGeneratedSummary({
				client,
				tableName: "test-table",
			});

			await expect(
				markSummaryPending({ url: "https://example.com/article" }),
			).resolves.toBeUndefined();
		});

		it("rethrows non-ConditionalCheck errors", async () => {
			const client = createSendingClient(() => {
				throw new Error("throttled");
			});
			const { markSummaryPending } = initDynamoDbGeneratedSummary({
				client,
				tableName: "test-table",
			});

			await expect(
				markSummaryPending({ url: "https://example.com/article" }),
			).rejects.toThrow("throttled");
		});
	});
});
