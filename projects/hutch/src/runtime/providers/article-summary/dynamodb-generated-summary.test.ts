import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { initDynamoDbGeneratedSummary } from "./dynamodb-generated-summary";

function createFakeClient(item: Record<string, unknown> | undefined): Partial<DynamoDBDocumentClient> {
	return {
		send: async () => ({ Item: item }),
	};
}

describe("initDynamoDbGeneratedSummary", () => {
	it("returns undefined when no row exists", async () => {
		const client = createFakeClient(undefined);
		const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
			client: client as typeof client & DynamoDBDocumentClient,
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
			client: client as typeof client & DynamoDBDocumentClient,
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
			client: client as typeof client & DynamoDBDocumentClient,
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
			client: client as typeof client & DynamoDBDocumentClient,
			tableName: "test-table",
		});

		const result = await findGeneratedSummary("https://example.com/article");

		expect(result).toEqual({ status: "ready", summary: "Fresh summary" });
	});

	it("returns ready with both summary and excerpt when summaryExcerpt is present", async () => {
		const client = createFakeClient({
			url: "https://example.com/article",
			summary: "Fresh summary",
			summaryExcerpt: "Decision-helper blurb",
			summaryStatus: "ready",
		});
		const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
			client: client as typeof client & DynamoDBDocumentClient,
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
			client: client as typeof client & DynamoDBDocumentClient,
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
			client: client as typeof client & DynamoDBDocumentClient,
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
			client: client as typeof client & DynamoDBDocumentClient,
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
			client: client as typeof client & DynamoDBDocumentClient,
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
			client: client as typeof client & DynamoDBDocumentClient,
			tableName: "test-table",
		});

		const result = await findGeneratedSummary("https://example.com/article");

		expect(result).toEqual({ status: "skipped" });
	});

	describe("findGeneratedSummariesByUrls", () => {
		it("returns an empty map for an empty input without hitting DynamoDB", async () => {
			let sendCalls = 0;
			const client: Partial<DynamoDBDocumentClient> = {
				send: async () => {
					sendCalls += 1;
					return {};
				},
			};
			const { findGeneratedSummariesByUrls } = initDynamoDbGeneratedSummary({
				client: client as typeof client & DynamoDBDocumentClient,
				tableName: "test-table",
			});

			const result = await findGeneratedSummariesByUrls([]);

			expect(result.size).toBe(0);
			expect(sendCalls).toBe(0);
		});

		it("maps each input URL to its summary, with missing rows mapped to undefined and the input URL preserved as the map key", async () => {
			const client: Partial<DynamoDBDocumentClient> = {
				send: async () => ({
					Responses: {
						"test-table": [
							// example.com/a is ready, example.com/b is pending, example.com/missing has no row at all.
							{ url: "example.com/a", summary: "Summary A", summaryStatus: "ready" },
							{ url: "example.com/b", summaryStatus: "pending" },
						],
					},
				}),
			};
			const { findGeneratedSummariesByUrls } = initDynamoDbGeneratedSummary({
				client: client as typeof client & DynamoDBDocumentClient,
				tableName: "test-table",
			});

			const inputs = [
				"https://example.com/a",
				"https://example.com/b",
				"https://example.com/missing",
			];
			const result = await findGeneratedSummariesByUrls(inputs);

			expect(result.get("https://example.com/a")).toEqual({ status: "ready", summary: "Summary A" });
			expect(result.get("https://example.com/b")).toEqual({ status: "pending" });
			// "missing" had no row; we still emit a Map entry mapped to undefined
			// so the caller can distinguish "not yet looked up" from "looked up
			// and not present" — important because the queue render uses the Map
			// to decide whether to fall back to metadata excerpt.
			expect(result.has("https://example.com/missing")).toBe(true);
			expect(result.get("https://example.com/missing")).toBeUndefined();
		});
	});

	it("returns skipped with reason when summarySkippedReason is present", async () => {
		const client = createFakeClient({
			url: "https://example.com/article",
			summaryStatus: "skipped",
			summarySkippedReason: "content-too-short",
		});
		const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
			client: client as typeof client & DynamoDBDocumentClient,
			tableName: "test-table",
		});

		const result = await findGeneratedSummary("https://example.com/article");

		expect(result).toEqual({ status: "skipped", reason: "content-too-short" });
	});
});
