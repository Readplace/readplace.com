import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { CRAWL_STAGE_TO_PCT, type CrawlStage as DomainCrawlStage } from "@packages/domain/article";
import { initDynamoDbMarkCrawlStage, type CrawlStage } from "./mark-crawl-stage";

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

describe("initDynamoDbMarkCrawlStage (unit)", () => {
	it("issues an unconditional UpdateItem that sets crawlStage", async () => {
		let received: unknown;
		const client = createFakeClient((input) => {
			received = input;
			return {};
		});
		const { markCrawlStage } = initDynamoDbMarkCrawlStage({
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
		const { markCrawlStage } = initDynamoDbMarkCrawlStage({
			client: client as DynamoDBDocumentClient,
			tableName: TABLE,
		});

		await expect(
			markCrawlStage({ url: URL, stage: "crawl-fetching" }),
		).rejects.toThrow("throttled");
	});

	it.each<CrawlStage>([
		"crawl-fetching",
		"crawl-fetched",
		"comprehensive-fetching",
		"comprehensive-extracting",
		"comprehensive-cleaning",
		"crawl-parsed",
		"crawl-metadata-written",
		"crawl-content-uploaded",
	])("accepts the %s stage and writes it verbatim (mirror of domain CrawlStage union)", async (stage) => {
		let received: unknown;
		const client = createFakeClient((input) => {
			received = input;
			return {};
		});
		const { markCrawlStage } = initDynamoDbMarkCrawlStage({
			client: client as DynamoDBDocumentClient,
			tableName: TABLE,
		});

		await markCrawlStage({ url: URL, stage });

		const command = received as { input: { ExpressionAttributeValues?: Record<string, unknown> } };
		expect(command.input.ExpressionAttributeValues?.[":stage"]).toBe(stage);
	});

	it("keeps the local CrawlStage literal aligned with the domain CrawlStage union (every value here must exist in CRAWL_STAGE_TO_PCT)", () => {
		const localStages: CrawlStage[] = [
			"crawl-fetching",
			"crawl-fetched",
			"comprehensive-fetching",
			"comprehensive-extracting",
			"comprehensive-cleaning",
			"crawl-parsed",
			"crawl-metadata-written",
			"crawl-content-uploaded",
		];
		for (const stage of localStages) {
			const widened: DomainCrawlStage = stage;
			expect(CRAWL_STAGE_TO_PCT[widened]).toBeGreaterThan(0);
		}
	});
});
