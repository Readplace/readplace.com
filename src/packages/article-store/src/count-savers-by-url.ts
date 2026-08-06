import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
} from "@packages/hutch-storage-client";
import { z } from "zod";

const UserArticleKeyRow = z.object({
	userId: z.string(),
	url: z.string(),
});

export type CountSaversByUrl = (url: string) => Promise<number>;

export function initCountSaversByUrl(deps: {
	client: Pick<DynamoDBDocumentClient, "send">;
	userArticlesTableName: string;
}): { countSaversByUrl: CountSaversByUrl } {
	const userArticles = defineDynamoTable({
		client: deps.client,
		tableName: deps.userArticlesTableName,
		schema: UserArticleKeyRow,
	});

	const countSaversByUrl: CountSaversByUrl = async (url) => {
		const id = ArticleResourceUniqueId.parse(url);
		let total = 0;
		let startKey: Record<string, unknown> | undefined;
		do {
			const { count, lastEvaluatedKey } = await userArticles.query({
				IndexName: "url-index",
				KeyConditionExpression: "#url = :url",
				ExpressionAttributeNames: { "#url": "url" },
				ExpressionAttributeValues: { ":url": id.value },
				Select: "COUNT",
				ExclusiveStartKey: startKey,
			});
			total += count;
			startKey = lastEvaluatedKey;
		} while (startKey);
		return total;
	};

	return { countSaversByUrl };
}
