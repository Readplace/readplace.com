import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { initDynamoDbMarkCrawlProgress } from "./mark-crawl-progress";

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

describe("initDynamoDbMarkCrawlProgress (unit)", () => {
	it("issues an unconditional UpdateItem that sets crawlPartCurrent and crawlPartTotal", async () => {
		let received: unknown;
		const client = createFakeClient((input) => {
			received = input;
			return {};
		});
		const { markCrawlProgress } = initDynamoDbMarkCrawlProgress({
			client: client as DynamoDBDocumentClient,
			tableName: TABLE,
		});

		await markCrawlProgress({ url: URL, partCurrent: 3, partTotal: 10 });

		const command = received as {
			input: {
				UpdateExpression?: string;
				ConditionExpression?: string;
				ExpressionAttributeValues?: Record<string, unknown>;
			};
		};
		expect(command.input.UpdateExpression).toContain("crawlPartCurrent = :current");
		expect(command.input.UpdateExpression).toContain("crawlPartTotal = :total");
		expect(command.input.ConditionExpression).toBeUndefined();
		expect(command.input.ExpressionAttributeValues?.[":current"]).toBe(3);
		expect(command.input.ExpressionAttributeValues?.[":total"]).toBe(10);
	});

	it("rethrows DynamoDB errors so a progress-write outage is observable in worker logs", async () => {
		const client = createFakeClient(() => {
			throw new Error("throttled");
		});
		const { markCrawlProgress } = initDynamoDbMarkCrawlProgress({
			client: client as DynamoDBDocumentClient,
			tableName: TABLE,
		});

		await expect(
			markCrawlProgress({ url: URL, partCurrent: 1, partTotal: 2 }),
		).rejects.toThrow("throttled");
	});
});
