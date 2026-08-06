import { initCountSaversByUrl } from "./count-savers-by-url";

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
