import assert from "node:assert/strict";
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

	describe("findGeneratedSummaries (batch)", () => {
		interface BatchRequest {
			Keys: { url: string }[];
			ProjectionExpression?: string;
			ExpressionAttributeNames?: Record<string, string>;
		}
		interface Captured {
			commands: { input: { RequestItems?: Record<string, BatchRequest> } }[];
		}

		function batchClient(
			rows: Record<string, unknown>[],
			captured: Captured,
		): DynamoDBDocumentClient {
			return createSendingClient((input) => {
				const command = input as Captured["commands"][number];
				captured.commands.push(command);
				const tableName = Object.keys(command.input.RequestItems ?? {})[0] ?? "test-table";
				return { Responses: { [tableName]: rows }, UnprocessedKeys: {} };
			});
		}

		function requestFor(captured: Captured): BatchRequest {
			const req = captured.commands[0]?.input.RequestItems?.["test-table"];
			assert(req, "a BatchGet must have been issued against test-table");
			return req;
		}

		it("issues one BatchGet with normalized, deduped keys and a projection that excludes content", async () => {
			const captured: Captured = { commands: [] };
			const client = batchClient(
				[{ url: "example.com/a", summaryStatus: "ready", summary: "A" }],
				captured,
			);
			const { findGeneratedSummaries } = initDynamoDbGeneratedSummary({ client, tableName: "test-table" });

			const map = await findGeneratedSummaries([
				"https://example.com/a",
				"https://example.com/a#heading", // strips to the same table key
			]);

			expect(captured.commands).toHaveLength(1);
			const req = requestFor(captured);
			expect(req.Keys).toEqual([{ url: "example.com/a" }]);
			const projectedNames = Object.values(req.ExpressionAttributeNames ?? {});
			expect(projectedNames).not.toContain("content");
			expect(projectedNames).toEqual(
				expect.arrayContaining(["url", "summaryStatus", "summary", "summaryExcerpt"]),
			);
			expect(req.ProjectionExpression).not.toContain("content");
			expect(map.get("https://example.com/a")).toEqual({ status: "ready", summary: "A" });
			expect(map.get("https://example.com/a#heading")).toEqual({ status: "ready", summary: "A" });
		});

		it("keys every input url, mapping a missing row to undefined", async () => {
			const captured: Captured = { commands: [] };
			const client = batchClient(
				[{ url: "example.com/present", summaryStatus: "ready", summary: "Here" }],
				captured,
			);
			const { findGeneratedSummaries } = initDynamoDbGeneratedSummary({ client, tableName: "test-table" });

			const map = await findGeneratedSummaries([
				"https://example.com/present",
				"https://example.com/absent",
			]);

			expect(map.has("https://example.com/absent")).toBe(true);
			expect(map.get("https://example.com/absent")).toBeUndefined();
			expect(map.get("https://example.com/present")).toEqual({ status: "ready", summary: "Here" });
		});

		it("degrades only the poisoned row (unknown status enum), mapping its siblings", async () => {
			const captured: Captured = { commands: [] };
			const client = batchClient(
				[
					{ url: "example.com/good", summaryStatus: "ready", summary: "Good" },
					{ url: "example.com/poison", summaryStatus: "not-a-real-status" },
				],
				captured,
			);
			const { findGeneratedSummaries } = initDynamoDbGeneratedSummary({ client, tableName: "test-table" });

			const map = await findGeneratedSummaries([
				"https://example.com/good",
				"https://example.com/poison",
			]);

			expect(map.get("https://example.com/poison")).toBeUndefined();
			expect(map.get("https://example.com/good")).toEqual({ status: "ready", summary: "Good" });
		});

		it("degrades a row that trips a mapper assert (ready without summary text) without throwing the batch", async () => {
			const captured: Captured = { commands: [] };
			const client = batchClient(
				[
					{ url: "example.com/ok", summaryStatus: "ready", summary: "OK" },
					{ url: "example.com/broken", summaryStatus: "ready" },
				],
				captured,
			);
			const { findGeneratedSummaries } = initDynamoDbGeneratedSummary({ client, tableName: "test-table" });

			const map = await findGeneratedSummaries([
				"https://example.com/ok",
				"https://example.com/broken",
			]);

			expect(map.get("https://example.com/broken")).toBeUndefined();
			expect(map.get("https://example.com/ok")).toEqual({ status: "ready", summary: "OK" });
		});

		it("maps an unparseable input url to undefined and never sends its key", async () => {
			const captured: Captured = { commands: [] };
			const client = batchClient(
				[{ url: "example.com/valid", summaryStatus: "pending" }],
				captured,
			);
			const { findGeneratedSummaries } = initDynamoDbGeneratedSummary({ client, tableName: "test-table" });

			const map = await findGeneratedSummaries(["https://example.com/valid", "not a url"]);

			expect(map.has("not a url")).toBe(true);
			expect(map.get("not a url")).toBeUndefined();
			expect(map.get("https://example.com/valid")).toEqual({ status: "pending" });
			expect(requestFor(captured).Keys).toEqual([{ url: "example.com/valid" }]);
		});

		it("sends no request for empty input", async () => {
			const captured: Captured = { commands: [] };
			const client = batchClient([], captured);
			const { findGeneratedSummaries } = initDynamoDbGeneratedSummary({ client, tableName: "test-table" });

			const map = await findGeneratedSummaries([]);

			expect(map.size).toBe(0);
			expect(captured.commands).toHaveLength(0);
		});
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
