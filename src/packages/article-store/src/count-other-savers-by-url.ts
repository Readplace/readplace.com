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

/** How many users other than `excludeUserId` currently have this URL saved.
 * The exclusion is explicit (a filter, not an off-by-one on the total) so
 * `url-index` GSI lag on the excluded user's own just-deleted row can never
 * keep the count above zero. */
export type CountOtherSaversByUrl = (params: {
	url: string;
	excludeUserId: string;
}) => Promise<number>;

export function initCountOtherSaversByUrl(deps: {
	client: DynamoDBDocumentClient;
	userArticlesTableName: string;
}): { countOtherSaversByUrl: CountOtherSaversByUrl } {
	const userArticles = defineDynamoTable({
		client: deps.client,
		tableName: deps.userArticlesTableName,
		schema: UserArticleKeyRow,
	});

	const countOtherSaversByUrl: CountOtherSaversByUrl = async (params) => {
		const id = ArticleResourceUniqueId.parse(params.url);
		let total = 0;
		let startKey: Record<string, unknown> | undefined;
		do {
			const { count, lastEvaluatedKey } = await userArticles.query({
				IndexName: "url-index",
				KeyConditionExpression: "#url = :url",
				FilterExpression: "userId <> :excluded",
				ExpressionAttributeNames: { "#url": "url" },
				ExpressionAttributeValues: {
					":url": id.value,
					":excluded": params.excludeUserId,
				},
				Select: "COUNT",
				ExclusiveStartKey: startKey,
			});
			total += count;
			startKey = lastEvaluatedKey;
		} while (startKey);
		return total;
	};

	return { countOtherSaversByUrl };
}
