import { S3Client } from "@aws-sdk/client-s3";
import { initDynamoDbPrivateItemMedia } from "@packages/article-store";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/infra-components/runtime";
import { Logger, consoleLogger } from "@packages/logger";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { initMediaObjectStore } from "@packages/media-object-store";
import { readEnv } from "@packages/require-env";
import { KEEP_AUDIO_ENV } from "./keep-audio.env";
import { initPutTierSource } from "@packages/tier-source";
import { initKeepAudioHandler } from "./keep-audio/keep-audio-handler";
import { initWriteMinimalAudioBody } from "./minimal-body/write-minimal-audio-body";
import { parseAudioStream } from "./probe/music-metadata-parse";
import { initProbeMedia } from "./probe/probe-media";
import { initS3StagedObject } from "./s3/s3-staged-object";

const env = readEnv(KEEP_AUDIO_ENV);

const s3Client = new S3Client({});
const dynamoClient = createDynamoDocumentClient();
const mediaBucketName = env.MEDIA_BUCKET_NAME;

const { setArticleEnclosure, findArticleMedia } = initDynamoDbPrivateItemMedia({ client: dynamoClient, tableName: env.DYNAMODB_ARTICLES_TABLE });
const { readStagedObject, copyStagedTo } = initS3StagedObject({ client: s3Client, bucketName: mediaBucketName });
const { putTierSource } = initPutTierSource({ client: s3Client, bucketName: env.CONTENT_BUCKET_NAME });
const { publishEvent } = initEventBridgePublisher({ client: new EventBridgeClient({}), eventBusName: env.EVENT_BUS_NAME });

export const handler = initKeepAudioHandler({
	findArticleMedia,
	readStagedObject,
	copyStagedTo,
	probeMedia: initProbeMedia({ parseAudioStream }),
	mediaObjects: initMediaObjectStore({ client: dynamoClient, tableName: env.MEDIA_TABLE_NAME, s3: s3Client, bucketName: mediaBucketName }),
	setArticleEnclosure,
	writeMinimalAudioBody: initWriteMinimalAudioBody({ putTierSource, publishEvent }),
	publishEvent,
	logger: Logger.from(consoleLogger),
});
