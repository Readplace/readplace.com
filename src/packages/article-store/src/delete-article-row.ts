import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { type DynamoDBDocumentClient, defineDynamoTable } from "@packages/storage-client";
import { z } from "zod";

const ArticleKeyRow = z.object({ url: z.string() });

export type DeleteArticleRow = (url: string) => Promise<void>;

export function initDeleteArticleRow(deps: {
	client: Pick<DynamoDBDocumentClient, "send">;
	tableName: string;
}): { deleteArticleRow: DeleteArticleRow } {
	const articles = defineDynamoTable({ client: deps.client, tableName: deps.tableName, schema: ArticleKeyRow });

	const deleteArticleRow: DeleteArticleRow = async (url) => {
		await articles.delete({ Key: { url: ArticleResourceUniqueId.parse(url).value } });
	};

	return { deleteArticleRow };
}
