import { tmpdir } from "node:os";
import { S3Client } from "@aws-sdk/client-s3";
import { initDynamoDbPrivateItem } from "@packages/article-store";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/infra-components/runtime";
import { Logger, consoleLogger } from "@packages/logger";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { requireEnv } from "@packages/require-env";
import { initPutTierSource } from "@packages/tier-source";
import { initProcessBookHandler } from "./process-book/process-book-handler";
import { initStoreBookImage } from "./process-book/store-book-image";
import { initDownloadStagedObject } from "./s3/download-staged-object";
import { initPutBookImage } from "./s3/put-book-image";

const READER_BODY_BYTE_LIMIT = 5_789_589;
const WHOLE_BODY_BYTE_LIMIT = 6_130_000;
const LARGEST_SECTION_BYTE_LIMIT = 5_430_060;

const s3Client = new S3Client({});
const mediaBucketName = requireEnv("MEDIA_BUCKET_NAME");

const { recordPrivateItemSections } = initDynamoDbPrivateItem({
	client: createDynamoDocumentClient(),
	tableName: requireEnv("DYNAMODB_ARTICLES_TABLE"),
	userArticlesTableName: requireEnv("DYNAMODB_USER_ARTICLES_TABLE"),
});
const { putTierSource } = initPutTierSource({ client: s3Client, bucketName: requireEnv("CONTENT_BUCKET_NAME") });
const { publishEvent } = initEventBridgePublisher({ client: new EventBridgeClient({}), eventBusName: requireEnv("EVENT_BUS_NAME") });

export const handler = initProcessBookHandler({
	downloadStagedObject: initDownloadStagedObject({ client: s3Client, bucketName: mediaBucketName, tmpDir: tmpdir() }),
	recordPrivateItemSections,
	putTierSource,
	storeBookImagesFor: initStoreBookImage({ putBookImage: initPutBookImage({ client: s3Client, bucketName: mediaBucketName }) }),
	publishEvent,
	readerBodyByteLimit: READER_BODY_BYTE_LIMIT,
	wholeBodyByteLimit: WHOLE_BODY_BYTE_LIMIT,
	largestSectionByteLimit: LARGEST_SECTION_BYTE_LIMIT,
	logger: Logger.from(consoleLogger),
});
