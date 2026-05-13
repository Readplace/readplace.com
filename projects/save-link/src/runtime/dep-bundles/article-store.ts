import type { S3Client } from "@aws-sdk/client-s3";
import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { initS3PutImageObject, type PutImageObject } from "../providers/article-store/s3-put-image-object";
import { initPutTierSource, type PutTierSource } from "../providers/article-store/put-tier-source";
import { initCheckTier0SourceExistsS3 } from "../providers/article-store/check-tier-0-source-exists-s3";
import { initReadArticleCrawlStateDynamoDb } from "../providers/article-store/read-article-crawl-state-dynamodb";
import {
	initReadTierSnapshot,
	type ReadTierSnapshot,
	type CheckTier0SourceExists,
	type ReadArticleCrawlState,
} from "../domain/crawl-article-state/read-tier-snapshot";

export type ArticleStoreDepBundle = {
	putTierSource: PutTierSource;
	putImageObject: PutImageObject;
	checkTier0SourceExists: CheckTier0SourceExists;
	readArticleCrawlState: ReadArticleCrawlState;
	readTierSnapshot: ReadTierSnapshot;
};

export function initArticleStoreDepBundle(deps: {
	s3Client: S3Client;
	dynamoClient: DynamoDBDocumentClient;
	contentBucketName: string;
	articlesTable: string;
}): ArticleStoreDepBundle {
	const { putImageObject } = initS3PutImageObject({
		client: deps.s3Client,
		bucketName: deps.contentBucketName,
	});
	const { putTierSource } = initPutTierSource({
		client: deps.s3Client,
		bucketName: deps.contentBucketName,
	});
	const { checkTier0SourceExists } = initCheckTier0SourceExistsS3({
		client: deps.s3Client,
		bucketName: deps.contentBucketName,
	});
	const { readArticleCrawlState } = initReadArticleCrawlStateDynamoDb({
		client: deps.dynamoClient,
		tableName: deps.articlesTable,
	});
	const { readTierSnapshot } = initReadTierSnapshot({
		checkTier0SourceExists,
		readArticleCrawlState,
	});
	return {
		putTierSource,
		putImageObject,
		checkTier0SourceExists,
		readArticleCrawlState,
		readTierSnapshot,
	};
}
