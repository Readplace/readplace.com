import { S3Client } from "@aws-sdk/client-s3";
import { initDynamoDbPrivateItemMedia } from "@packages/article-store";
import {
	EventBridgeClient,
	initEventBridgePublisher,
} from "@packages/infra-components/runtime";
import { Logger, consoleLogger } from "@packages/logger";
import { readEnv } from "@packages/require-env";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { initPutTierSource } from "@packages/tier-source";
import { initDynamoDbTranscriptLedger } from "@packages/transcript-quota";
import { initWriteMinimalAudioBody } from "./minimal-body/write-minimal-audio-body";
import { RENDER_TRANSCRIPT_ENV } from "./render-transcript.env";
import { initFindReleasedTranscript } from "./render/find-released-transcript";
import { initRenderTranscriptHandler } from "./render/render-completed";
import { initS3TranscriptFiles } from "./s3/s3-transcript-files";

const env = readEnv(RENDER_TRANSCRIPT_ENV);

const s3Client = new S3Client({});
const dynamoClient = createDynamoDocumentClient();

const { findArticleMedia, recordTranscriptOutcome } =
	initDynamoDbPrivateItemMedia({
		client: dynamoClient,
		tableName: env.DYNAMODB_ARTICLES_TABLE,
	});
const { readJobRequest, readTranscriptOutput, deletePrefix } =
	initS3TranscriptFiles({
		client: s3Client,
		bucketName: env.MEDIA_BUCKET_NAME,
	});
const { settleTranscriptCharge } = initDynamoDbTranscriptLedger({
	client: dynamoClient,
	tableName: env.MEDIA_TABLE_NAME,
	now: () => new Date(),
	delay: (milliseconds) =>
		new Promise((resolve) => setTimeout(resolve, milliseconds)),
});
const { putTierSource } = initPutTierSource({
	client: s3Client,
	bucketName: env.CONTENT_BUCKET_NAME,
});
const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName: env.EVENT_BUS_NAME,
});

export const handler = initRenderTranscriptHandler({
	findReleasedTranscript: initFindReleasedTranscript({
		readJobRequest,
		findArticleMedia,
		settleTranscriptCharge,
		deletePrefix,
	}),
	readTranscriptOutput,
	putTierSource,
	publishEvent,
	writeMinimalAudioBody: initWriteMinimalAudioBody({
		putTierSource,
		publishEvent,
	}),
	recordTranscriptOutcome,
	settleTranscriptCharge,
	logger: Logger.from(consoleLogger),
});
