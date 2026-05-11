import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
} from "@packages/hutch-storage-client";
import { initDynamoDbArticleCrawl } from "./dynamodb-article-crawl";

type SendFn = DynamoDBDocumentClient["send"];

function createFakeClient(
	impl: (input: unknown) => unknown,
): Partial<DynamoDBDocumentClient> {
	return {
		send: (async (input: unknown) => impl(input)) as unknown as SendFn,
	};
}

const TABLE = "test-articles";
const URL = "https://example.com/article";

describe("initDynamoDbArticleCrawl (unit)", () => {
	describe("markCrawlReady", () => {
		it("issues an UpdateItem that sets crawlStatus=ready and clears failure fields", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const { markCrawlReady } = initDynamoDbArticleCrawl({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			await markCrawlReady({ url: URL });

			const command = received as {
				input: {
					UpdateExpression?: string;
					ExpressionAttributeValues?: Record<string, unknown>;
					ConditionExpression?: string;
				};
			};
			expect(command.input.UpdateExpression).toContain("crawlStatus = :ready");
			expect(command.input.UpdateExpression).toContain(
				"REMOVE crawlFailureReason, crawlFailedAt",
			);
			expect(command.input.ExpressionAttributeValues?.[":ready"]).toBe("ready");
			expect(command.input.ConditionExpression).toBeUndefined();
		});
	});

	describe("markCrawlFailed", () => {
		it("issues an UpdateItem with a guard against regressing from ready", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const { markCrawlFailed } = initDynamoDbArticleCrawl({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			await markCrawlFailed({ url: URL, reason: "timeout" });

			const command = received as {
				input: {
					UpdateExpression?: string;
					ConditionExpression?: string;
					ExpressionAttributeValues?: Record<string, unknown>;
				};
			};
			expect(command.input.UpdateExpression).toContain(
				"crawlStatus = :failed",
			);
			expect(command.input.UpdateExpression).toContain(
				"crawlFailureReason = :reason",
			);
			expect(command.input.UpdateExpression).toContain(
				"crawlFailedAt = :failedAt",
			);
			expect(command.input.ConditionExpression).toContain(
				"attribute_not_exists(crawlStatus)",
			);
			expect(command.input.ConditionExpression).toContain(
				"crawlStatus = :pending",
			);
			expect(command.input.ConditionExpression).toContain(
				"crawlStatus = :failed",
			);
			expect(command.input.ExpressionAttributeValues?.[":reason"]).toBe(
				"timeout",
			);
		});
	});

	describe("markCrawlUnsupported", () => {
		it("issues an UpdateItem with a guard against regressing from ready", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const { markCrawlUnsupported } = initDynamoDbArticleCrawl({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			await markCrawlUnsupported({ url: URL, reason: "non-html content type: application/pdf" });

			const command = received as {
				input: {
					UpdateExpression?: string;
					ConditionExpression?: string;
					ExpressionAttributeValues?: Record<string, unknown>;
				};
			};
			expect(command.input.UpdateExpression).toContain(
				"crawlStatus = :unsupported",
			);
			expect(command.input.UpdateExpression).toContain(
				"crawlUnsupportedReason = :reason",
			);
			expect(command.input.UpdateExpression).toContain(
				"crawlFailedAt = :failedAt",
			);
			expect(command.input.ConditionExpression).toContain(
				"attribute_not_exists(crawlStatus)",
			);
			expect(command.input.ConditionExpression).toContain(
				"crawlStatus = :pending",
			);
			expect(command.input.ConditionExpression).toContain(
				"crawlStatus = :failed",
			);
			expect(command.input.ConditionExpression).toContain(
				"crawlStatus = :unsupported",
			);
			expect(command.input.ExpressionAttributeValues?.[":reason"]).toBe(
				"non-html content type: application/pdf",
			);
			expect(command.input.ExpressionAttributeValues?.[":unsupported"]).toBe(
				"unsupported",
			);
		});

		it("swallows ConditionalCheckFailedException (ready row preserved)", async () => {
			const client = createFakeClient(() => {
				throw new ConditionalCheckFailedException({
					$metadata: {},
					message: "condition failed",
				});
			});
			const { markCrawlUnsupported } = initDynamoDbArticleCrawl({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			await expect(
				markCrawlUnsupported({ url: URL, reason: "r" }),
			).resolves.toBeUndefined();
		});

		it("rethrows non-ConditionalCheck errors", async () => {
			const client = createFakeClient(() => {
				throw new Error("throttled");
			});
			const { markCrawlUnsupported } = initDynamoDbArticleCrawl({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			await expect(
				markCrawlUnsupported({ url: URL, reason: "r" }),
			).rejects.toThrow("throttled");
		});
	});

	describe("markCrawlStage", () => {
		it("issues an unconditional UpdateItem that sets crawlStage", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const { markCrawlStage } = initDynamoDbArticleCrawl({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			await markCrawlStage({ url: URL, stage: "crawl-fetched" });

			const command = received as {
				input: {
					UpdateExpression?: string;
					ConditionExpression?: string;
					ExpressionAttributeValues?: Record<string, unknown>;
				};
			};
			expect(command.input.UpdateExpression).toBe("SET crawlStage = :stage");
			expect(command.input.ConditionExpression).toBeUndefined();
			expect(command.input.ExpressionAttributeValues?.[":stage"]).toBe(
				"crawl-fetched",
			);
		});

		it("rethrows DynamoDB errors so a stage-write outage is observable in worker logs", async () => {
			const client = createFakeClient(() => {
				throw new Error("throttled");
			});
			const { markCrawlStage } = initDynamoDbArticleCrawl({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			await expect(
				markCrawlStage({ url: URL, stage: "crawl-fetching" }),
			).rejects.toThrow("throttled");
		});
	});

	describe("error handling", () => {
		it("swallows ConditionalCheckFailedException on markCrawlFailed (ready row preserved)", async () => {
			const client = createFakeClient(() => {
				throw new ConditionalCheckFailedException({
					$metadata: {},
					message: "condition failed",
				});
			});
			const { markCrawlFailed } = initDynamoDbArticleCrawl({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			await expect(
				markCrawlFailed({ url: URL, reason: "r" }),
			).resolves.toBeUndefined();
		});

		it("rethrows non-ConditionalCheck errors on markCrawlFailed", async () => {
			const client = createFakeClient(() => {
				throw new Error("throttled");
			});
			const { markCrawlFailed } = initDynamoDbArticleCrawl({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			await expect(markCrawlFailed({ url: URL, reason: "r" })).rejects.toThrow(
				"throttled",
			);
		});

		it("rethrows errors on markCrawlReady (no swallowing — ready writes are unconditional)", async () => {
			const client = createFakeClient(() => {
				throw new Error("throttled");
			});
			const { markCrawlReady } = initDynamoDbArticleCrawl({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			await expect(markCrawlReady({ url: URL })).rejects.toThrow("throttled");
		});
	});
});
