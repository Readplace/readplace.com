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

function clientReturning(
	item: Record<string, unknown> | undefined,
): DynamoDBDocumentClient {
	return createFakeClient(() => ({ Item: item })) as DynamoDBDocumentClient;
}

const TABLE = "test-table";
const URL = "https://example.com/article";
const FROZEN_NOW = new Date("2026-07-17T10:00:00.000Z");
const now = () => FROZEN_NOW;

describe("initDynamoDbArticleCrawl", () => {
	describe("findArticleCrawlStatus", () => {
		it("returns undefined when no row exists", async () => {
			const { findArticleCrawlStatus } = initDynamoDbArticleCrawl({
				client: clientReturning(undefined),
				tableName: TABLE,
				now,
			});

			const result = await findArticleCrawlStatus(URL);

			expect(result).toBeUndefined();
		});

		it("returns undefined for a legacy row that has no crawlStatus attribute", async () => {
			// Legacy rows pre-date the crawl state machine. The crawlStatus column
			// is absent on rows whose content was migrated to S3, and we can't tell
			// from the row alone whether the body exists. Return undefined and let
			// the caller (which can read S3) decide ready vs unavailable.
			const { findArticleCrawlStatus } = initDynamoDbArticleCrawl({
				client: clientReturning({ url: URL }),
				tableName: TABLE,
				now,
			});

			const result = await findArticleCrawlStatus(URL);

			expect(result).toBeUndefined();
		});

		it("returns pending when crawlStatus=pending", async () => {
			const { findArticleCrawlStatus } = initDynamoDbArticleCrawl({
				client: clientReturning({ url: URL, crawlStatus: "pending" }),
				tableName: TABLE,
				now,
			});

			const result = await findArticleCrawlStatus(URL);

			expect(result).toEqual({ status: "pending" });
		});

		it("returns pending with stage when crawlStage is recorded", async () => {
			const { findArticleCrawlStatus } = initDynamoDbArticleCrawl({
				client: clientReturning({
					url: URL,
					crawlStatus: "pending",
					crawlStage: "crawl-parsed",
				}),
				tableName: TABLE,
				now,
			});

			const result = await findArticleCrawlStatus(URL);

			expect(result).toEqual({ status: "pending", stage: "crawl-parsed" });
		});

		it("returns pending with parts when crawlPartCurrent and crawlPartTotal are recorded", async () => {
			const { findArticleCrawlStatus } = initDynamoDbArticleCrawl({
				client: clientReturning({
					url: URL,
					crawlStatus: "pending",
					crawlStage: "comprehensive-extracting",
					crawlPartCurrent: 17,
					crawlPartTotal: 150,
				}),
				tableName: TABLE,
				now,
			});

			const result = await findArticleCrawlStatus(URL);

			expect(result).toEqual({
				status: "pending",
				stage: "comprehensive-extracting",
				parts: { current: 17, total: 150 },
			});
		});

		it("omits parts when only one of crawlPartCurrent / crawlPartTotal is present", async () => {
			const { findArticleCrawlStatus } = initDynamoDbArticleCrawl({
				client: clientReturning({
					url: URL,
					crawlStatus: "pending",
					crawlStage: "comprehensive-extracting",
					crawlPartCurrent: 17,
				}),
				tableName: TABLE,
				now,
			});

			const result = await findArticleCrawlStatus(URL);

			expect(result).toEqual({
				status: "pending",
				stage: "comprehensive-extracting",
			});
		});

		it("does not surface parts on terminal ready rows", async () => {
			const { findArticleCrawlStatus } = initDynamoDbArticleCrawl({
				client: clientReturning({
					url: URL,
					crawlStatus: "ready",
					crawlPartCurrent: 4,
					crawlPartTotal: 4,
				}),
				tableName: TABLE,
				now,
			});

			const result = await findArticleCrawlStatus(URL);

			expect(result).toEqual({ status: "ready" });
		});

		it("returns ready when crawlStatus=ready", async () => {
			const { findArticleCrawlStatus } = initDynamoDbArticleCrawl({
				client: clientReturning({ url: URL, crawlStatus: "ready" }),
				tableName: TABLE,
				now,
			});

			const result = await findArticleCrawlStatus(URL);

			expect(result).toEqual({ status: "ready" });
		});

		it("returns failed with reason when crawlStatus=failed", async () => {
			const { findArticleCrawlStatus } = initDynamoDbArticleCrawl({
				client: clientReturning({
					url: URL,
					crawlStatus: "failed",
					crawlFailureReason: "connect timeout",
				}),
				tableName: TABLE,
				now,
			});

			const result = await findArticleCrawlStatus(URL);

			expect(result).toEqual({ status: "failed", reason: "connect timeout" });
		});

		it("returns unsupported with reason when crawlStatus=unsupported", async () => {
			const { findArticleCrawlStatus } = initDynamoDbArticleCrawl({
				client: clientReturning({
					url: URL,
					crawlStatus: "unsupported",
					crawlUnsupportedReason: "non-html content type: application/pdf",
				}),
				tableName: TABLE,
				now,
			});

			const result = await findArticleCrawlStatus(URL);

			expect(result).toEqual({
				status: "unsupported",
				reason: "non-html content type: application/pdf",
			});
		});

		it("throws when crawlStatus=failed is persisted without a crawlFailureReason", async () => {
			const { findArticleCrawlStatus } = initDynamoDbArticleCrawl({
				client: clientReturning({ url: URL, crawlStatus: "failed" }),
				tableName: TABLE,
				now,
			});

			await expect(findArticleCrawlStatus(URL)).rejects.toThrow(
				"crawlStatus=failed row must carry a crawlFailureReason",
			);
		});

		it("throws when crawlStatus=unsupported is persisted without a crawlUnsupportedReason", async () => {
			const { findArticleCrawlStatus } = initDynamoDbArticleCrawl({
				client: clientReturning({ url: URL, crawlStatus: "unsupported" }),
				tableName: TABLE,
				now,
			});

			await expect(findArticleCrawlStatus(URL)).rejects.toThrow(
				"crawlStatus=unsupported row must carry a crawlUnsupportedReason",
			);
		});
	});

	describe("markCrawlPending", () => {
		it("issues an UpdateItem that sets crawlStatus=pending and stamps crawlPendingSince so the stuck-articles canary's age gate anchors on when this crawl began, with a guard against ready rows", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const { markCrawlPending } = initDynamoDbArticleCrawl({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now,
			});

			await markCrawlPending({ url: URL });

			const command = received as {
				input: {
					UpdateExpression?: string;
					ConditionExpression?: string;
					ExpressionAttributeValues?: Record<string, unknown>;
				};
			};
			expect(command.input.UpdateExpression).toBe(
				"SET crawlStatus = :pending, crawlPendingSince = :pendingSince",
			);
			expect(command.input.ConditionExpression).toBe(
				"attribute_not_exists(crawlStatus) OR crawlStatus <> :ready",
			);
			expect(command.input.ExpressionAttributeValues?.[":pending"]).toBe(
				"pending",
			);
			expect(command.input.ExpressionAttributeValues?.[":pendingSince"]).toBe(
				FROZEN_NOW.toISOString(),
			);
			expect(command.input.ExpressionAttributeValues?.[":ready"]).toBe("ready");
		});

		it("swallows ConditionalCheckFailedException so ready rows stay ready", async () => {
			const client = createFakeClient(() => {
				throw new ConditionalCheckFailedException({
					$metadata: {},
					message: "condition failed",
				});
			});
			const { markCrawlPending } = initDynamoDbArticleCrawl({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now,
			});

			await expect(markCrawlPending({ url: URL })).resolves.toBeUndefined();
		});

		it("rethrows non-ConditionalCheck errors", async () => {
			const client = createFakeClient(() => {
				throw new Error("throttled");
			});
			const { markCrawlPending } = initDynamoDbArticleCrawl({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now,
			});

			await expect(markCrawlPending({ url: URL })).rejects.toThrow("throttled");
		});
	});

	describe("forceMarkCrawlPending", () => {
		it("issues an unconditional UpdateItem that sets crawlStatus=pending, stamps crawlPendingSince so a force-recrawled row is not misread as stuck by the canary's age gate, and clears the terminal-failure reason columns", async () => {
			let received: unknown;
			const client = createFakeClient((input) => {
				received = input;
				return {};
			});
			const { forceMarkCrawlPending } = initDynamoDbArticleCrawl({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now,
			});

			await forceMarkCrawlPending({ url: URL });

			const command = received as {
				input: {
					UpdateExpression?: string;
					ConditionExpression?: string;
					ExpressionAttributeValues?: Record<string, unknown>;
				};
			};
			expect(command.input.UpdateExpression).toBe(
				"SET crawlStatus = :pending, crawlPendingSince = :pendingSince REMOVE crawlFailureReason, crawlUnsupportedReason",
			);
			expect(command.input.ConditionExpression).toBeUndefined();
			expect(command.input.ExpressionAttributeValues?.[":pending"]).toBe(
				"pending",
			);
			expect(command.input.ExpressionAttributeValues?.[":pendingSince"]).toBe(
				FROZEN_NOW.toISOString(),
			);
		});

		it("propagates any DynamoDB error (no condition-failed swallow)", async () => {
			const client = createFakeClient(() => {
				throw new Error("throttled");
			});
			const { forceMarkCrawlPending } = initDynamoDbArticleCrawl({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
				now,
			});

			await expect(forceMarkCrawlPending({ url: URL })).rejects.toThrow(
				"throttled",
			);
		});
	});
});
