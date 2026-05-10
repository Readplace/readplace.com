/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { ArticleResourceUniqueId } from "./article-resource-unique-id";
import type { RefreshArticleContent } from "./refresh-article-content-handler";

const ArticleRow = z.object({
	url: z.string(),
	title: dynamoField(z.string()),
	siteName: dynamoField(z.string()),
	excerpt: dynamoField(z.string()),
	wordCount: dynamoField(z.number()),
	estimatedReadTime: dynamoField(z.number()),
	contentFetchedAt: dynamoField(z.string()),
	etag: dynamoField(z.string()),
	lastModified: dynamoField(z.string()),
	imageUrl: dynamoField(z.string()),
});

export function initRefreshArticleContent(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): { refreshArticleContent: RefreshArticleContent } {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: ArticleRow,
	});

	const refreshArticleContent: RefreshArticleContent = async (params) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		// Refreshing content invalidates the cached summary. Atomically (a) clear
		// every summary-derived attribute and (b) flip summaryStatus back to
		// pending so the row never sits in the inconsistent (status=ready,
		// summary=missing) state that the reader UI maps to a forever-polling
		// "Generating summary…". Caller dispatches GenerateSummaryCommand
		// immediately after this resolves so the worker picks the row up.
		await table.update({
			Key: { url: articleResourceUniqueId.value },
			UpdateExpression:
				"SET title = :title, siteName = :siteName, excerpt = :excerpt, wordCount = :wordCount, estimatedReadTime = :ert, contentFetchedAt = :cfa, etag = :etag, lastModified = :lm, imageUrl = :img, summaryStatus = :pending REMOVE summary, summaryExcerpt, summaryInputTokens, summaryOutputTokens, summaryStage, summaryFailureReason, summarySkippedReason",
			ExpressionAttributeValues: {
				":title": params.metadata.title,
				":siteName": params.metadata.siteName,
				":excerpt": params.metadata.excerpt,
				":wordCount": params.metadata.wordCount,
				":ert": params.estimatedReadTime,
				":cfa": params.contentFetchedAt,
				":etag": params.etag ?? null,
				":lm": params.lastModified ?? null,
				":img": params.metadata.imageUrl ?? null,
				":pending": "pending",
			},
		});
	};

	return { refreshArticleContent };
}
/* c8 ignore stop */
