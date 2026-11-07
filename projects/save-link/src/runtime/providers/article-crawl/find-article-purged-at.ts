import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/storage-client";
import { z } from "zod";
import { ArticleResourceUniqueId } from "../../domain/save-link/article-resource-unique-id";
import type { FindArticlePurgedAt } from "../../domain/stale-check/find-article-purged-at.types";

const PurgedAtRow = z.object({
	purgedAt: dynamoField(z.string()),
});

export function initFindArticlePurgedAt(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): { findArticlePurgedAt: FindArticlePurgedAt } {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: PurgedAtRow,
	});

	const findArticlePurgedAt: FindArticlePurgedAt = async (url) => {
		const row = await table.get(
			{ url: ArticleResourceUniqueId.parse(url).value },
			{ projection: ["purgedAt"] },
		);
		return row?.purgedAt;
	};

	return { findArticlePurgedAt };
}
