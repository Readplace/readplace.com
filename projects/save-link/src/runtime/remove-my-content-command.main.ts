import { S3Client } from "@aws-sdk/client-s3";
import { consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import {
	EventBridgeClient,
	initEventBridgePublisher,
} from "@packages/hutch-infra-components/runtime";
import {
	initCountOtherSaversByUrl,
	initPruneCrawlVersions,
	initPurgeArticleContent,
	initResolveAuthoredContentKeys,
	initS3DeleteContentObjects,
	initS3ListContentKeys,
	initTombstoneArticle,
} from "@packages/article-store";
import { requireEnv } from "@packages/require-env";
import { initReadTierSource } from "./providers/article-store/read-tier-source";
import { initListAvailableTierSources } from "./domain/select-content/list-available-tier-sources";
import { initRemoveMyContentCommandHandler } from "./domain/remove-my-content/remove-my-content-command-handler";

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const userArticlesTable = requireEnv("DYNAMODB_USER_ARTICLES_TABLE");
const contentBucketName = requireEnv("CONTENT_BUCKET_NAME");
const eventBusName = requireEnv("EVENT_BUS_NAME");

const s3Client = new S3Client({});
const dynamoClient = createDynamoDocumentClient();

const { resolveAuthoredContentKeys } = initResolveAuthoredContentKeys({
	s3Client,
	dynamoClient,
	tableName: articlesTable,
	bucketName: contentBucketName,
});

const { deleteContentObjects } = initS3DeleteContentObjects({
	client: s3Client,
	bucketName: contentBucketName,
});

const { listContentKeys } = initS3ListContentKeys({
	client: s3Client,
	bucketName: contentBucketName,
});

const { pruneCrawlVersions } = initPruneCrawlVersions({
	client: dynamoClient,
	tableName: articlesTable,
});

const { readTierSource } = initReadTierSource({
	client: s3Client,
	bucketName: contentBucketName,
	logger: consoleLogger,
});

const { listAvailableTierSources } = initListAvailableTierSources({ readTierSource });

const { countOtherSaversByUrl } = initCountOtherSaversByUrl({
	client: dynamoClient,
	userArticlesTableName: userArticlesTable,
});

const { purgeArticleContent } = initPurgeArticleContent({
	listContentKeys,
	deleteContentObjects,
});

const { tombstoneArticle } = initTombstoneArticle({
	client: dynamoClient,
	tableName: articlesTable,
});

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName,
});

export const handler = initRemoveMyContentCommandHandler({
	resolveAuthoredContentKeys,
	deleteContentObjects,
	pruneCrawlVersions,
	listAvailableTierSources,
	countOtherSaversByUrl,
	purgeArticleContent,
	tombstoneArticle,
	publishEvent,
	now: () => new Date(),
	logger: consoleLogger,
});
