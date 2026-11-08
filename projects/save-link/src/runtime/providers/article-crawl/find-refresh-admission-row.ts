import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/storage-client";
import { z } from "zod";
import { ArticleResourceUniqueId } from "../../domain/save-link/article-resource-unique-id";
import type { FindRefreshAdmissionRow } from "../../domain/save-link/decide-refresh-skip";

const RefreshAdmissionRowSchema = z.object({
	purgedAt: dynamoField(z.string()),
	contentFetchedAt: dynamoField(z.string()),
	savedAt: dynamoField(z.string()),
	crawlStatus: dynamoField(z.string()),
});

export function initFindRefreshAdmissionRow(deps: {
	client: Pick<DynamoDBDocumentClient, "send">;
	tableName: string;
}): { findRefreshAdmissionRow: FindRefreshAdmissionRow } {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: RefreshAdmissionRowSchema,
	});

	const findRefreshAdmissionRow: FindRefreshAdmissionRow = async (url) => {
		const row = await table.get(
			{ url: ArticleResourceUniqueId.parse(url).value },
			{ projection: ["purgedAt", "contentFetchedAt", "savedAt", "crawlStatus"], consistentRead: true },
		);
		if (!row) return undefined;
		return {
			purgedAt: row.purgedAt,
			contentFetchedAt: row.contentFetchedAt,
			savedAt: row.savedAt,
			crawlStatus: row.crawlStatus,
		};
	};

	return { findRefreshAdmissionRow };
}
