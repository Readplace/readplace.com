/* c8 ignore start -- thin AWS SDK wrapper, tested via production canaries (article-pipeline-health) */
import assert from "node:assert";
import type { S3Client } from "@aws-sdk/client-s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { ArticleResourceUniqueId } from "../../domain/save-link/article-resource-unique-id";
import { parseS3Uri } from "../../domain/save-link/parse-s3-uri";

export type ArticleContentResult = { content: string; imageUrl?: string };
export type FindArticleContent = (url: string) => Promise<ArticleContentResult | undefined>;

const ArticleContentRow = z.object({
	contentLocation: dynamoField(z.string()),
	imageUrl: dynamoField(z.string()),
});

export function initFindArticleContent(deps: {
	dynamoClient: DynamoDBDocumentClient;
	s3Client: S3Client;
	tableName: string;
}): { findArticleContent: FindArticleContent } {
	const { dynamoClient, s3Client, tableName } = deps;

	const articleTable = defineDynamoTable({
		client: dynamoClient,
		tableName,
		schema: ArticleContentRow,
	});

	const findArticleContent: FindArticleContent = async (url) => {
		const parsed = await articleTable.get(
			{ url: ArticleResourceUniqueId.parse(url).value },
			{ projection: ["contentLocation", "imageUrl"] },
		);
		assert(parsed, "result.Item must exist");
		if (!parsed.contentLocation) return undefined;

		const { bucket, key } = parseS3Uri(parsed.contentLocation);
		const s3Result = await s3Client.send(
			new GetObjectCommand({ Bucket: bucket, Key: key }),
		);
		assert(s3Result.Body, "S3 GetObject response must have a Body");
		const content = await s3Result.Body.transformToString("utf-8");

		return { content, imageUrl: parsed.imageUrl };
	};

	return { findArticleContent };
}
/* c8 ignore stop */
