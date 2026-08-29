import type { UserId } from "@packages/domain/user";
import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { initCountOtherSaversByUrl } from "./count-other-savers-by-url";

const REMOVING_USER = "user-1" as UserId;

/**
 * 1. The DocumentClient `send` is a heavily-overloaded generic the test fake
 *    cannot structurally satisfy; the single contained cast is the isolated
 *    SDK-wrapper exception in CLAUDE.md "Avoid TypeScript Type Assertions".
 */
function createFakeDynamo(
	pages: { Count: number; LastEvaluatedKey?: Record<string, unknown> }[],
	capture: (input: Record<string, unknown>) => void,
): DynamoDBDocumentClient {
	let call = 0;
	const send = async (command: { input: Record<string, unknown> }) => {
		capture(command.input);
		const page = pages[call];
		call += 1;
		return page;
	};
	return { send } as unknown as DynamoDBDocumentClient /* 1 */;
}

const TABLE = "user-articles";

describe("initCountOtherSaversByUrl", () => {
	it("counts url-index rows excluding the removing user with a COUNT query", async () => {
		const inputs: Record<string, unknown>[] = [];
		const { countOtherSaversByUrl } = initCountOtherSaversByUrl({
			client: createFakeDynamo([{ Count: 2 }], (input) => inputs.push(input)),
			userArticlesTableName: TABLE,
		});

		const count = await countOtherSaversByUrl({
			url: "https://example.com/post",
			excludeUserId: REMOVING_USER,
		});

		expect(count).toBe(2);
		expect(inputs).toEqual([
			{
				TableName: TABLE,
				IndexName: "url-index",
				KeyConditionExpression: "#url = :url",
				FilterExpression: "userId <> :excluded AND NOT begins_with(userId, :excludedReadlists)",
				ExpressionAttributeNames: { "#url": "url" },
				ExpressionAttributeValues: {
					":url": "example.com/post",
					":excluded": "user-1",
					":excludedReadlists": "user-1#queue/",
				},
				Select: "COUNT",
				ExclusiveStartKey: undefined,
			},
		]);
	});

	it("excludes the removing user's own readlist copies so their content is still purged as a sole saver", async () => {
		const inputs: Record<string, unknown>[] = [];
		const { countOtherSaversByUrl } = initCountOtherSaversByUrl({
			client: createFakeDynamo([{ Count: 0 }], (input) => inputs.push(input)),
			userArticlesTableName: TABLE,
		});

		expect(
			await countOtherSaversByUrl({
				url: "https://example.com/post",
				excludeUserId: REMOVING_USER,
			}),
		).toBe(0);
		expect(inputs[0]?.FilterExpression).toContain("NOT begins_with(userId, :excludedReadlists)");
	});

	it("sums counts across paginated index pages", async () => {
		const inputs: Record<string, unknown>[] = [];
		const { countOtherSaversByUrl } = initCountOtherSaversByUrl({
			client: createFakeDynamo(
				[
					{ Count: 3, LastEvaluatedKey: { userId: "user-9" } },
					{ Count: 1 },
				],
				(input) => inputs.push(input),
			),
			userArticlesTableName: TABLE,
		});

		const count = await countOtherSaversByUrl({
			url: "https://example.com/post",
			excludeUserId: REMOVING_USER,
		});

		expect(count).toBe(4);
		expect(inputs[1].ExclusiveStartKey).toEqual({ userId: "user-9" });
	});
});
