import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import {
	writeIfCondition,
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/storage-client";
import type {
	MarkRelatedPassesRequested,
	ReadRelatedPassRequestState,
} from "@packages/provider-contracts/related-articles";
import { z } from "zod";

const UserArticleRelatedRequestRow = z.object({
	userId: z.string(),
	url: z.string(),
	savedAt: dynamoField(z.string()),
	relatedPassesRequestedAt: dynamoField(z.string()),
	relatedStatus: dynamoField(z.enum(["ready", "skipped"])),
	pastReadsComputedAt: dynamoField(z.string()),
});

export function initDynamoDbRelatedPassRequests(deps: {
	client: DynamoDBDocumentClient;
	userArticlesTableName: string;
	now: () => Date;
}): {
	readRelatedPassRequestState: ReadRelatedPassRequestState;
	markRelatedPassesRequested: MarkRelatedPassesRequested;
} {
	const userArticles = defineDynamoTable({
		client: deps.client,
		tableName: deps.userArticlesTableName,
		schema: UserArticleRelatedRequestRow,
	});

	const readRelatedPassRequestState: ReadRelatedPassRequestState = async (params) => {
		const row = await userArticles.get(
			{ userId: params.userId, url: ArticleResourceUniqueId.parse(params.url).value },
			{ consistentRead: true },
		);
		if (row?.savedAt === undefined) return { saved: false };
		return {
			saved: true,
			...(row.relatedPassesRequestedAt !== undefined
				? { requestedAt: new Date(row.relatedPassesRequestedAt) }
				: {}),
			...(row.relatedStatus !== undefined ? { nextRead: row.relatedStatus } : {}),
			...(row.pastReadsComputedAt !== undefined
				? { pastReadsComputedAt: new Date(row.pastReadsComputedAt) }
				: {}),
		};
	};

	const markRelatedPassesRequested: MarkRelatedPassesRequested = async (params) => {
		const outcome = await writeIfCondition(() => userArticles.update({
			Key: { userId: params.userId, url: ArticleResourceUniqueId.parse(params.url).value },
			UpdateExpression:
				"SET relatedPassesRequestedAt = if_not_exists(relatedPassesRequestedAt, :at)",
			ConditionExpression: "attribute_exists(savedAt)",
			ExpressionAttributeValues: { ":at": deps.now().toISOString() },
		}));
		if (outcome.kind === "condition-failed") return "row-absent";
		return "marked";
	};

	return { readRelatedPassRequestState, markRelatedPassesRequested };
}
