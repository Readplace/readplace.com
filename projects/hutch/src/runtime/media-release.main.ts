import { S3Client } from "@aws-sdk/client-s3";
import {
	initDeleteArticleRow,
	initDeleteUserArticleLinks,
	initDynamoDbFindItemOwner,
	initDynamoDbSavedArticleStore,
	initPurgeArticleContent,
	initS3DeleteContentObjects,
	initS3ListContentKeys,
} from "@packages/article-store";
import { Logger, consoleLogger } from "@packages/logger";
import { LinkDequeuedEvent, ReleaseHeldUploadCommand } from "@packages/infra-components";
import { initHandleByDetailType, initSqsRecordHandler } from "@packages/infra-components/runtime";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { initMediaObjectStore } from "@packages/media-object-store";
import { readEnv } from "@packages/require-env";
import { initDynamoDbTranscriptLedger } from "@packages/transcript-quota";
import { MEDIA_RELEASE_ENV } from "./media-release.env";
import { initMediaReleaseHandler } from "./media-release/media-release-handler";
import { initBulkUploadRetention } from "./media-release/bulk-upload-retention";
import { initPrivateItemReleaseSteps, initReleasePrivateItem } from "./media-release/private-item-release-steps";

const env = readEnv(MEDIA_RELEASE_ENV);

const articlesTable = env.DYNAMODB_ARTICLES_TABLE;
const userArticlesTable = env.DYNAMODB_USER_ARTICLES_TABLE;
const contentBucketName = env.CONTENT_BUCKET_NAME;
const mediaBucketName = env.MEDIA_BUCKET_NAME;
const mediaTableName = env.MEDIA_TABLE_NAME;

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
		mediaObjects: initMediaObjectStore({ client: dynamoClient, tableName: mediaTableName, s3: s3Client, bucketName: mediaBucketName }),
		deleteUserArticleLinks: initDeleteUserArticleLinks({ client: dynamoClient, tableName: userArticlesTable })
			.deleteUserArticleLinks,
		settleStartedCharge: initDynamoDbTranscriptLedger({
			client: dynamoClient,
			tableName: mediaTableName,
			now: () => new Date(),
			delay: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
		}).settleStartedCharge,
	}),
});

const logger = Logger.from(consoleLogger);
const now = () => new Date();
const saves = initDynamoDbSavedArticleStore({ client: dynamoClient, tableName: articlesTable, userArticlesTableName: userArticlesTable, logger, now });
const retention = initBulkUploadRetention({ client: dynamoClient, tableName: userArticlesTable, listUserSavesForUrl: saves.listUserSavesForUrl, releasePrivateItem, now });
export const handler = initHandleByDetailType({
	logger,
	routes: {
		[LinkDequeuedEvent.detailType]: [initMediaReleaseHandler({ logger, releasePrivateItem: retention.releaseIfUnheld })],
		[ReleaseHeldUploadCommand.detailType]: [initSqsRecordHandler({
			definition: ReleaseHeldUploadCommand, logger, failure: { message: "[media-release] expired hold release failed" }, malformed: { policy: "retry" },
			handle: ({ marker }) => retention.releaseExpired(marker),
		})],
	},
});
