import type { UserId } from "@packages/domain/user";
import { initCountOtherSaversByUrl, initCountSaversByUrl } from "./count-savers-by-url";

const REMOVING_USER = "user-1" as UserId;

function createFakeDynamo(
	pages: { Count: number; LastEvaluatedKey?: Record<string, unknown> }[],
	capture: (input: Record<string, unknown>) => void,
) {
	let call = 0;
	const send = async (command: { input: Record<string, unknown> }) => {
		capture(command.input);
		const page = pages[call];
		call += 1;
		return page;
	};
	return { send };
}

const TABLE = "user-articles";

describe("initCountSaversByUrl", () => {
	it("counts every url-index row, the removing user included, with a COUNT query", async () => {
		const inputs: Record<string, unknown>[] = [];
		const { countSaversByUrl } = initCountSaversByUrl({
			client: createFakeDynamo([{ Count: 3 }], (input) => inputs.push(input)),
			userArticlesTableName: TABLE,
		});

		const count = await countSaversByUrl("https://example.com/post");

		expect(count).toBe(3);
		expect(inputs).toEqual([
			{
				TableName: TABLE,
				IndexName: "url-index",
				KeyConditionExpression: "#url = :url",
				ExpressionAttributeNames: { "#url": "url" },
				ExpressionAttributeValues: { ":url": "example.com/post" },
				Select: "COUNT",
				ExclusiveStartKey: undefined,
			},
		]);
	});

	it("sums counts across paginated index pages", async () => {
		const inputs: Record<string, unknown>[] = [];
		const { countSaversByUrl } = initCountSaversByUrl({
			client: createFakeDynamo(
				[
					{ Count: 3, LastEvaluatedKey: { userId: "user-9" } },
					{ Count: 1 },
				],
				(input) => inputs.push(input),
			),
			userArticlesTableName: TABLE,
		});

		const count = await countSaversByUrl("https://example.com/post");

		expect(count).toBe(4);
		expect(inputs[1].ExclusiveStartKey).toEqual({ userId: "user-9" });
	});
});

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
