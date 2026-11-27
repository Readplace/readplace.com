import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
} from "@packages/storage-client";
import type { UserId } from "@packages/domain/user";
import { z } from "zod";
import { readlistPartitionPrefix } from "./user-readlist-partition";

const UserArticleKeyRow = z.object({
	userId: z.string(),
	url: z.string(),
});

export type CountSaversByUrl = (url: string) => Promise<number>;

/** How many users other than `excludeUserId` currently have this URL saved.
 * The exclusion is explicit (a filter, not an off-by-one on the total) so
 * `url-index` GSI lag on the excluded user's own just-deleted row can never
 * keep the count above zero. */
export type CountOtherSaversByUrl = (params: {
	url: string;
	excludeUserId: UserId;
}) => Promise<number>;

function initCountUrlIndexRows(deps: {
	client: Pick<DynamoDBDocumentClient, "send">;
	userArticlesTableName: string;
}) {
	const userArticles = defineDynamoTable({
		client: deps.client,
		tableName: deps.userArticlesTableName,
		schema: UserArticleKeyRow,
	});

	return async (params: {
		url: string;
		filter?: { expression: string; values: Record<string, unknown> };
	}): Promise<number> => {
		const id = ArticleResourceUniqueId.parse(params.url);
		let total = 0;
		let startKey: Record<string, unknown> | undefined;
		do {
			const { count, lastEvaluatedKey } = await userArticles.query({
				IndexName: "url-index",
				KeyConditionExpression: "#url = :url",
				...(params.filter ? { FilterExpression: params.filter.expression } : {}),
				ExpressionAttributeNames: { "#url": "url" },
				ExpressionAttributeValues: { ":url": id.value, ...params.filter?.values },
				Select: "COUNT",
				ExclusiveStartKey: startKey,
			});
			total += count;
			startKey = lastEvaluatedKey;
		} while (startKey);
		return total;
	};
}

export function initCountSaversByUrl(deps: {
	client: Pick<DynamoDBDocumentClient, "send">;
	userArticlesTableName: string;
}): { countSaversByUrl: CountSaversByUrl } {
	const countUrlIndexRows = initCountUrlIndexRows(deps);
	return { countSaversByUrl: (url) => countUrlIndexRows({ url }) };
}

export function initCountOtherSaversByUrl(deps: {
	client: Pick<DynamoDBDocumentClient, "send">;
	userArticlesTableName: string;
}): { countOtherSaversByUrl: CountOtherSaversByUrl } {
	const countUrlIndexRows = initCountUrlIndexRows(deps);
	return {
		countOtherSaversByUrl: (params) =>
			countUrlIndexRows({
				url: params.url,
				filter: {
					expression: "userId <> :excluded AND NOT begins_with(userId, :excludedReadlists)",
					values: {
						":excluded": params.excludeUserId,
						":excludedReadlists": readlistPartitionPrefix(params.excludeUserId),
					},
				},
			}),
	};
}
