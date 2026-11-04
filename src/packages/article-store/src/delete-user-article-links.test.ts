import type { DynamoDBDocumentClient } from "@packages/storage-client";
import { initDeleteUserArticleLinks } from "./delete-user-article-links";

function createFakeDynamo(impl: (input: Record<string, unknown>) => unknown): DynamoDBDocumentClient {
	const send = async (command: { input: Record<string, unknown> }) => impl(command.input);
	return { send } as unknown as DynamoDBDocumentClient;
}

const URL = "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef";
const KEY = "uploads.readplace.invalid/0123456789abcdef0123456789abcdef";

describe("initDeleteUserArticleLinks", () => {
	it("deletes every user-article row the url-index returns, default and readlist partitions, across pages", async () => {
		const queries: Record<string, unknown>[] = [];
		const deletes: unknown[] = [];
		const pages = [
			{ Items: [{ userId: "owner", url: KEY }], LastEvaluatedKey: { userId: "owner", url: KEY } },
			{ Items: [{ userId: "owner#readlist#books", url: KEY }] },
		];
		const { deleteUserArticleLinks } = initDeleteUserArticleLinks({
			client: createFakeDynamo((input) => {
				if ("KeyConditionExpression" in input) {
					queries.push(input);
					return pages[queries.length - 1];
				}
				deletes.push(input);
				return {};
			}),
			tableName: "user-articles",
		});

		await deleteUserArticleLinks(URL);

		expect(queries.map((query) => [query.IndexName, query.ExpressionAttributeValues, query.ExclusiveStartKey])).toEqual([
			["url-index", { ":url": KEY }, undefined],
			["url-index", { ":url": KEY }, { userId: "owner", url: KEY }],
		]);
		expect(deletes).toEqual([
			{ TableName: "user-articles", Key: { userId: "owner", url: KEY } },
			{ TableName: "user-articles", Key: { userId: "owner#readlist#books", url: KEY } },
		]);
	});

	it("deletes nothing when no user-article row holds the url", async () => {
		const deletes: unknown[] = [];
		const { deleteUserArticleLinks } = initDeleteUserArticleLinks({
			client: createFakeDynamo((input) => {
				if ("KeyConditionExpression" in input) return { Items: [] };
				deletes.push(input);
				return {};
			}),
			tableName: "user-articles",
		});

		await deleteUserArticleLinks(URL);

		expect(deletes).toEqual([]);
	});
});
