/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { ArticleResourceUniqueId } from "../../domain/save-link/article-resource-unique-id";
import type { UpdateFetchTimestamp } from "../../domain/save-link/update-fetch-timestamp-handler";

const ArticleRow = z.object({
	url: z.string(),
	contentFetchedAt: dynamoField(z.string()),
});

export function initUpdateFetchTimestamp(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): { updateFetchTimestamp: UpdateFetchTimestamp } {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: ArticleRow,
	});

	const updateFetchTimestamp: UpdateFetchTimestamp = async (params) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		const sets = ["contentFetchedAt = :cfa"];
		const values: Record<string, unknown> = { ":cfa": params.contentFetchedAt };
		if (params.etag !== undefined) {
			sets.push("etag = :etag");
			values[":etag"] = params.etag;
		}
		if (params.lastModified !== undefined) {
			sets.push("lastModified = :lm");
			values[":lm"] = params.lastModified;
		}
		if (params.bodyHash !== undefined) {
			sets.push("bodyHash = :bh");
			values[":bh"] = params.bodyHash;
		}
		await table.update({
			Key: { url: articleResourceUniqueId.value },
			UpdateExpression: `SET ${sets.join(", ")}`,
			ExpressionAttributeValues: values,
		});
	};

	return { updateFetchTimestamp };
}
/* c8 ignore stop */
