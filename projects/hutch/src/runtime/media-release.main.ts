import { S3Client } from "@aws-sdk/client-s3";
import {
	initDeleteArticleRow,
	initDeleteUserArticleLinks,
	initDynamoDbFindItemOwner,
	initPurgeArticleContent,
	initS3DeleteContentObjects,
	initS3ListContentKeys,
} from "@packages/article-store";
import { Logger, consoleLogger } from "@packages/logger";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { readEnv } from "@packages/require-env";
import { MEDIA_RELEASE_ENV } from "./media-release.env";
import { initMediaReleaseHandler } from "./media-release/media-release-handler";
import { initPrivateItemReleaseSteps, initReleasePrivateItem } from "./media-release/private-item-release-steps";

const env = readEnv(MEDIA_RELEASE_ENV);

const articlesTable = env.DYNAMODB_ARTICLES_TABLE;
const userArticlesTable = env.DYNAMODB_USER_ARTICLES_TABLE;
const contentBucketName = env.CONTENT_BUCKET_NAME;
const mediaBucketName = env.MEDIA_BUCKET_NAME;

const dynamoClient = createDynamoDocumentClient();
const s3Client = new S3Client({});

const { purgeArticleContent } = initPurgeArticleContent({
	listContentKeys: initS3ListContentKeys({ client: s3Client, bucketName: contentBucketName }).listContentKeys,
	deleteContentObjects: initS3DeleteContentObjects({ client: s3Client, bucketName: contentBucketName }).deleteContentObjects,
});

const releasePrivateItem = initReleasePrivateItem({
	findItemOwner: initDynamoDbFindItemOwner({ client: dynamoClient, tableName: articlesTable }).findItemOwner,
	steps: initPrivateItemReleaseSteps({
		purgeArticleContent,
		deleteMediaObjects: initS3DeleteContentObjects({ client: s3Client, bucketName: mediaBucketName }).deleteContentObjects,
		listMediaKeys: initS3ListContentKeys({ client: s3Client, bucketName: mediaBucketName }).listContentKeys,
		deleteArticleRow: initDeleteArticleRow({ client: dynamoClient, tableName: articlesTable }).deleteArticleRow,
		deleteUserArticleLinks: initDeleteUserArticleLinks({ client: dynamoClient, tableName: userArticlesTable })
			.deleteUserArticleLinks,
	}),
});

export const handler = initMediaReleaseHandler({
	releasePrivateItem,
	logger: Logger.from(consoleLogger),
});
