/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { ArticleResourceUniqueId } from "../../domain/save-link/article-resource-unique-id";
import type { FindArticleFreshness } from "@packages/test-fixtures/providers/article-store";

const FreshnessRow = z.object({
	etag: dynamoField(z.string()),
	lastModified: dynamoField(z.string()),
	contentFetchedAt: dynamoField(z.string()),
	bodyHash: dynamoField(z.string()),
});

export function initFindArticleFreshness(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): { findArticleFreshness: FindArticleFreshness } {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: FreshnessRow,
	});

	const findArticleFreshness: FindArticleFreshness = async (url) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const row = await table.get(
			{ url: articleResourceUniqueId.value },
			{ projection: ["etag", "lastModified", "contentFetchedAt", "bodyHash"] },
		);
		if (!row) return null;
		return {
			etag: row.etag,
			lastModified: row.lastModified,
			contentFetchedAt: row.contentFetchedAt,
			bodyHash: row.bodyHash,
		};
	};

	return { findArticleFreshness };
}
/* c8 ignore stop */
