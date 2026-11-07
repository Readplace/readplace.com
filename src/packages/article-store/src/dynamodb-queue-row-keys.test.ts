import { UserIdSchema } from "@packages/domain/user";
import { initDynamoDbFindQueueRowKeys } from "./dynamodb-queue-row-keys";

const TABLE = "user-articles";
const userId = UserIdSchema.parse("user-1");

type StoredKey = { userId: string; url: string };
type BatchGetRequest = { Keys: StoredKey[]; ConsistentRead?: boolean };
type SentInput = { RequestItems?: Record<string, BatchGetRequest> } & Record<string, unknown>;

function fakeUserArticles(params: { readlistSlugs: string[]; queueRows: StoredKey[] }) {
	const queries: SentInput[] = [];
	const batchGets: BatchGetRequest[] = [];
	const client = {
		send: async (command: { input: SentInput }) => {
			const requestItems = command.input.RequestItems;
			if (requestItems === undefined) {
				queries.push(command.input);
				return {
					Items: params.readlistSlugs.map((slug) => ({ queueSlug: slug, createdAt: "2026-11-01T00:00:00.000Z" })),
					Count: params.readlistSlugs.length,
				};
			}
			const request = requestItems[TABLE];
			if (request === undefined) throw new Error(`BatchGet named no ${TABLE} table`);
			batchGets.push(request);
			return {
				Responses: {
					[TABLE]: params.queueRows.filter((row) =>
						request.Keys.some((key) => key.userId === row.userId && key.url === row.url),
					),
				},
			};
		},
	};
	const findQueueRowKeys = initDynamoDbFindQueueRowKeys({ client, userArticlesTableName: TABLE });
	return { findQueueRowKeys, queries, batchGets };
}

describe("initDynamoDbFindQueueRowKeys", () => {
	it("reads the readlist definitions and the queue rows with consistent reads", async () => {
		const { findQueueRowKeys, queries, batchGets } = fakeUserArticles({ readlistSlugs: [], queueRows: [] });

		await findQueueRowKeys({ userId, urls: ["https://example.com/post"] });

		expect(queries[0]).toMatchObject({
			TableName: TABLE,
			KeyConditionExpression: "userId = :userId AND begins_with(#url, :prefix)",
			ExpressionAttributeValues: { ":userId": "user-1", ":prefix": "readplace:queue-def/" },
			ConsistentRead: true,
		});
		expect(batchGets[0]?.ConsistentRead).toBe(true);
	});

	it("looks for every candidate in the default partition and every readlist partition", async () => {
		const { findQueueRowKeys, batchGets } = fakeUserArticles({ readlistSlugs: ["work"], queueRows: [] });

		await findQueueRowKeys({ userId, urls: ["https://example.com/post"] });

		expect(batchGets[0]?.Keys).toEqual([
			{ userId: "user-1", url: "example.com/post" },
			{ userId: "user-1#queue/work", url: "example.com/post" },
		]);
	});

	it("returns the found keys as partition and url", async () => {
		const { findQueueRowKeys } = fakeUserArticles({
			readlistSlugs: ["work"],
			queueRows: [{ userId: "user-1#queue/work", url: "example.com/post" }],
		});

		const keys = await findQueueRowKeys({ userId, urls: ["https://example.com/post"] });

		expect(keys).toEqual([{ userId: "user-1#queue/work", url: "example.com/post" }]);
	});

	it("asks only the default partition for a reader with no readlists", async () => {
		const { findQueueRowKeys, batchGets } = fakeUserArticles({ readlistSlugs: [], queueRows: [] });

		await findQueueRowKeys({ userId, urls: ["https://example.com/post"] });

		expect(batchGets[0]?.Keys).toEqual([{ userId: "user-1", url: "example.com/post" }]);
	});

	it("keys a raw candidate the way a save stores it, without scheme, fragment or tracking parameters", async () => {
		const { findQueueRowKeys, batchGets } = fakeUserArticles({ readlistSlugs: [], queueRows: [] });

		await findQueueRowKeys({ userId, urls: ["https://example.com/post?utm_source=mail#section"] });

		expect(batchGets[0]?.Keys).toEqual([{ userId: "user-1", url: "example.com/post" }]);
	});

	it("asks once per partition for two candidates that differ only by scheme or fragment", async () => {
		const { findQueueRowKeys, batchGets } = fakeUserArticles({ readlistSlugs: ["work"], queueRows: [] });

		await findQueueRowKeys({
			userId,
			urls: ["https://example.com/post", "http://example.com/post", "https://example.com/post#top"],
		});

		expect(batchGets[0]?.Keys).toEqual([
			{ userId: "user-1", url: "example.com/post" },
			{ userId: "user-1#queue/work", url: "example.com/post" },
		]);
	});

	it("drops a key over 1,024 bytes even when the submitted URL has far fewer characters, and keeps one of exactly 1,024", async () => {
		const { findQueueRowKeys, batchGets } = fakeUserArticles({ readlistSlugs: [], queueRows: [] });
		const exactPath = "a".repeat(1024 - "example.com/".length);
		const multibytePath = "é".repeat(170);

		await findQueueRowKeys({
			userId,
			urls: [`https://example.com/${exactPath}`, `https://example.com/${multibytePath}`],
		});

		expect(batchGets[0]?.Keys).toEqual([{ userId: "user-1", url: `example.com/${exactPath}` }]);
	});

	it("reads nothing when every candidate key is too long to store", async () => {
		const { findQueueRowKeys, queries, batchGets } = fakeUserArticles({ readlistSlugs: [], queueRows: [] });

		const keys = await findQueueRowKeys({ userId, urls: [`https://example.com/${"a".repeat(2000)}`] });

		expect(keys).toEqual([]);
		expect(queries).toEqual([]);
		expect(batchGets).toEqual([]);
	});
});
