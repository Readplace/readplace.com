import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { initDeleteArticleRow } from "./delete-article-row";

function createFakeDynamo(impl: (input: Record<string, unknown>) => unknown): DynamoDBDocumentClient {
	const send = async (command: { input: Record<string, unknown> }) => impl(command.input);
	return { send } as unknown as DynamoDBDocumentClient;
}

describe("initDeleteArticleRow", () => {
	it("deletes the article row by its storage key, with no condition", async () => {
		const deletes: Record<string, unknown>[] = [];
		const { deleteArticleRow } = initDeleteArticleRow({
			client: createFakeDynamo((input) => {
				deletes.push(input);
				return {};
			}),
			tableName: "articles",
		});

		await deleteArticleRow("https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef");

		expect(deletes).toEqual([
			{ TableName: "articles", Key: { url: "uploads.readplace.invalid/0123456789abcdef0123456789abcdef" } },
		]);
	});
});
