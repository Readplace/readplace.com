import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { type DynamoDBDocumentClient, defineDynamoTable, forEachQueryPage } from "@packages/storage-client";
import { z } from "zod";

const UserArticleKeyRow = z.object({ userId: z.string(), url: z.string() });

export type DeleteUserArticleLinks = (url: string) => Promise<void>;

export function initDeleteUserArticleLinks(deps: {
	client: Pick<DynamoDBDocumentClient, "send">;
	tableName: string;
}): { deleteUserArticleLinks: DeleteUserArticleLinks } {
	const userArticles = defineDynamoTable({ client: deps.client, tableName: deps.tableName, schema: UserArticleKeyRow });

	const deleteUserArticleLinks: DeleteUserArticleLinks = async (url) => {
		await forEachQueryPage(
			userArticles,
			{
				IndexName: "url-index",
				KeyConditionExpression: "#url = :url",
				ExpressionAttributeNames: { "#url": "url" },
				ExpressionAttributeValues: { ":url": ArticleResourceUniqueId.parse(url).value },
			},
			async (rows) => {
				for (const row of rows) {
					await userArticles.delete({ Key: { userId: row.userId, url: row.url } });
				}
			},
		);
	};

	return { deleteUserArticleLinks };
}
