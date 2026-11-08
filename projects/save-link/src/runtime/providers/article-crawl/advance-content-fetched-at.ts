import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
} from "@packages/storage-client";
import { z } from "zod";
import { ArticleResourceUniqueId } from "../../domain/save-link/article-resource-unique-id";
import type { AdvanceContentFetchedAt } from "../../domain/save-link/update-fetch-timestamp-handler";

export function initAdvanceContentFetchedAt(deps: {
	client: Pick<DynamoDBDocumentClient, "send">;
	tableName: string;
}): { advanceContentFetchedAt: AdvanceContentFetchedAt } {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: z.object({}),
	});

	const advanceContentFetchedAt: AdvanceContentFetchedAt = async (params) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		try {
			await table.update({
				Key: { url: articleResourceUniqueId.value },
				UpdateExpression: "SET contentFetchedAt = :cfa",
				ConditionExpression:
					"attribute_not_exists(purgedAt) AND (" +
					"contentFetchedAt < :cfa OR " +
					"(attribute_not_exists(contentFetchedAt) AND savedAt <= :cfa))",
				ExpressionAttributeValues: { ":cfa": params.contentFetchedAt },
			});
			return "advanced";
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) return "superseded";
			throw error;
		}
	};

	return { advanceContentFetchedAt };
}
