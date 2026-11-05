import { tmpdir } from "node:os";
import { S3Client } from "@aws-sdk/client-s3";
import { initDynamoDbPrivateItem } from "@packages/article-store";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { requireEnv } from "@packages/require-env";
import { initPutTierSource } from "@packages/tier-source";
import { initProcessBookHandler } from "./process-book/process-book-handler";
import { initDownloadStagedObject } from "./s3/download-staged-object";

const READER_BODY_BYTE_LIMIT = 5_789_589;

const s3Client = new S3Client({});

const { recordPrivateItemSections } = initDynamoDbPrivateItem({
	client: createDynamoDocumentClient(),
	tableName: requireEnv("DYNAMODB_ARTICLES_TABLE"),
	userArticlesTableName: requireEnv("DYNAMODB_USER_ARTICLES_TABLE"),
});
const { putTierSource } = initPutTierSource({ client: s3Client, bucketName: requireEnv("CONTENT_BUCKET_NAME") });
const { publishEvent } = initEventBridgePublisher({ client: new EventBridgeClient({}), eventBusName: requireEnv("EVENT_BUS_NAME") });

export const handler = initProcessBookHandler({
	downloadStagedObject: initDownloadStagedObject({ client: s3Client, bucketName: requireEnv("MEDIA_BUCKET_NAME"), tmpDir: tmpdir() }),
	recordPrivateItemSections,
	putTierSource,
	publishEvent,
	readerBodyByteLimit: READER_BODY_BYTE_LIMIT,
	logger: HutchLogger.from(consoleLogger),
});
