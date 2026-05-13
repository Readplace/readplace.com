import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { initDynamoDbMarkSummaryStage } from "./mark-summary-stage";

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

describe("initDynamoDbMarkSummaryStage (unit)", () => {
	it("issues an unconditional UpdateItem that sets summaryStage", async () => {
		let received: unknown;
		const client = createFakeClient((input) => {
			received = input;
			return {};
		});
		const { markSummaryStage } = initDynamoDbMarkSummaryStage({
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

	it("rethrows DynamoDB errors so a summary-stage write outage is observable in worker logs", async () => {
		const client = createFakeClient(() => {
			throw new Error("throttled");
		});
		const { markSummaryStage } = initDynamoDbMarkSummaryStage({
			client: client as DynamoDBDocumentClient,
			tableName: TABLE,
		});

		await expect(
			markSummaryStage({ url: URL, stage: "summary-started" }),
		).rejects.toThrow("throttled");
	});
});
